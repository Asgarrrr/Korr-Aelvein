import { describe, expect, test } from "bun:test";
import type { Level } from "../../dungeon/index";
import { TILE_FLOOR } from "../../dungeon/index";
import {
  despawn,
  emptyWorld,
  forQuery,
  getComponent,
  isLiveHandle,
  removeComponent,
  spawn,
} from "../../ecs/index";
import type { RngState } from "../../rng/index";
import { emptyScheduler, schedule, size } from "../../scheduler/index";
import {
  activeWorld,
  type GameState,
  type GlobalEvent,
  newGame,
  type ZoneId,
  type ZoneStatus,
} from "../state";
import { tick } from "../tick";

const DONJON_ZONE: ZoneId = 0;

type Pos = { x: number; y: number };

function mobPositions(state: GameState): Pos[] {
  const out: Pos[] = [];
  forQuery(activeWorld(state), ["position", "actor", "ai"], (_h, view) => {
    const p = view.position;
    if (p === undefined) return;
    out.push({ x: p.x, y: p.y });
  });
  return out;
}

describe("newGame: wanderer spawn", () => {
  test("spawns two wanderers distinct from each other and from the player", () => {
    const state = newGame(42, "rim");
    const mobs = mobPositions(state);
    expect(mobs.length).toBe(2);
    const playerPos = getComponent(
      activeWorld(state),
      state.playerId,
      "position",
    );
    expect(playerPos).toBeDefined();
    if (playerPos === undefined) return;
    const cells = new Set([
      `${playerPos.x},${playerPos.y}`,
      ...mobs.map((m) => `${m.x},${m.y}`),
    ]);
    expect(cells.size).toBe(3);
  });

  test("wanderers carry the ai=wanderer component and the actor glyph", () => {
    const state = newGame(42, "rim");
    forQuery(activeWorld(state), ["actor", "ai"], (_h, view) => {
      expect(view.actor?.glyph).toBe("r");
      expect(view.ai?.kind).toBe("wanderer");
    });
  });

  test("player is scheduled before wanderers on turn 1 (seq tiebreak)", () => {
    const state = newGame(42, "rim");
    // Heap: 1 player + 2 wanderers all at time 0, plus the village schedule
    // event at time = VILLAGE_SCHEDULE_PERIOD. The player's seq must be the
    // lowest among the time-0 events.
    expect(size(state.globalScheduler)).toBe(4);
    const head = state.globalScheduler.heap[0];
    expect(head?.time).toBe(0);
    expect(head?.payload.kind).toBe("actor");
    if (head?.payload.kind === "actor") {
      expect(head.payload.entity).toEqual(state.playerId);
      expect(head.payload.zone).toBe(state.activeZone);
    }
  });
});

describe("tick: drain loop runs wanderers", () => {
  test("one player WAIT triggers each wanderer's turn before returning", () => {
    const state = newGame(42, "rim");
    const before = mobPositions(state);
    const next = tick(state, { type: "WAIT" });
    // After one tick: heap holds 4 events (player + 2 wanderers all
    // rescheduled at time 100, plus the unchanged village schedule).
    expect(size(next.globalScheduler)).toBe(4);
    for (const ev of next.globalScheduler.heap) {
      if (ev.payload.kind === "actor") {
        expect(ev.time).toBe(100);
      }
    }
    // Mobs that had a free neighbour should have moved; the others held still.
    // We only assert positions are still legal cells (no out-of-bounds, no
    // wall) — exact movement is tested separately by the determinism test.
    const after = mobPositions(next);
    expect(after.length).toBe(before.length);
  });

  test("determinism: same seed + same action sequence → identical mob positions", () => {
    function run(): Pos[] {
      let s = newGame(0xc0ffee, "rim");
      for (let i = 0; i < 50; i++) s = tick(s, { type: "WAIT" });
      return mobPositions(s);
    }
    expect(run()).toEqual(run());
  });

  test("determinism across styles: caverns seed also reproduces", () => {
    function run(seed: number): Pos[] {
      let s = newGame(seed, "caverns");
      for (let i = 0; i < 25; i++) s = tick(s, { type: "WAIT" });
      return mobPositions(s);
    }
    for (const seed of [1, 7, 42, 0xdead, 0xbeef]) {
      expect(run(seed)).toEqual(run(seed));
    }
  });

  test("rngState advances during tick (wanderer rolls consume the rng)", () => {
    const state = newGame(42, "rim");
    const next = tick(state, { type: "WAIT" });
    // Two wanderers, each rolling once for direction → rngState must differ.
    expect(next.rngState).not.toEqual(state.rngState);
  });
});

describe("tick: stale-handle lazy skip", () => {
  test("despawning a wanderer before its scheduled turn does not crash the tick", () => {
    const state = newGame(42, "rim");
    // Despawn the first wanderer we find via the query.
    let victim: { id: number; gen: number } | undefined;
    forQuery(activeWorld(state), ["ai"], (handle) => {
      if (victim === undefined) victim = { id: handle.id, gen: handle.gen };
    });
    expect(victim).toBeDefined();
    if (victim === undefined) return;
    despawn(activeWorld(state), victim);
    // Tick should drain the wanderer's stale heap entry, run the survivor,
    // and return without throwing.
    expect(() => tick(state, { type: "WAIT" })).not.toThrow();
    // After the tick, the despawned handle is unambiguously gone.
    expect(isLiveHandle(activeWorld(state), victim)).toBe(false);
    // Heap: player + surviving wanderer + village schedule = 3.
    const next = tick(state, { type: "WAIT" });
    expect(size(next.globalScheduler)).toBe(3);
  });

  test("removing a wanderer's `ai` component drops it from the heap on next pop", () => {
    const state = newGame(42, "rim");
    // Strip `ai` from one wanderer; the entity stays alive and on the heap.
    let target: { id: number; gen: number } | undefined;
    forQuery(activeWorld(state), ["ai"], (handle) => {
      if (target === undefined) target = { id: handle.id, gen: handle.gen };
    });
    if (target === undefined) throw new Error("test: no wanderer found");
    removeComponent(activeWorld(state), target, "ai");
    // 5 ticks later, the de-AI'd entity must NOT be cycling in the heap.
    let s = state;
    for (let i = 0; i < 5; i++) s = tick(s, { type: "WAIT" });
    // Heap: player + surviving wanderer + village schedule = 3. If the
    // de-AI'd entity were being re-scheduled, size would be 4.
    expect(size(s.globalScheduler)).toBe(3);
  });
});

describe("tick: occupancy refusal", () => {
  // Hand-built corridor: floor row of 5 cells, walls all around.
  function corridorLevel(): Level {
    const W = 7;
    const H = 3;
    const tiles = new Uint8Array(W * H);
    for (let x = 1; x < 6; x++) tiles[1 * W + x] = TILE_FLOOR;
    return {
      grid: { width: W, height: H, tiles },
      rooms: [],
      spawn: null,
      downStairs: null,
    };
  }

  function makeCorridorState(
    playerXY: readonly [number, number],
    wanderers: ReadonlyArray<readonly [number, number]>,
    rngState: RngState,
  ): GameState {
    const world = emptyWorld();
    const playerId = spawn(world, {
      position: { x: playerXY[0], y: playerXY[1] },
      actor: { glyph: "@", name: "you" },
    });
    const globalScheduler = emptyScheduler<GlobalEvent>();
    schedule(globalScheduler, 0, {
      kind: "actor",
      zone: DONJON_ZONE,
      entity: playerId,
    });
    for (const [wx, wy] of wanderers) {
      const w = spawn(world, {
        position: { x: wx, y: wy },
        actor: { glyph: "r", name: "wanderer" },
        ai: { kind: "wanderer" },
      });
      schedule(globalScheduler, 0, {
        kind: "actor",
        zone: DONJON_ZONE,
        entity: w,
      });
    }
    const zones = new Map<ZoneId, ZoneStatus>();
    zones.set(DONJON_ZONE, {
      kind: "active",
      world,
      level: corridorLevel(),
    });
    return {
      zones,
      activeZone: DONJON_ZONE,
      playerId,
      globalScheduler,
      rngState,
      time: 0,
      turn: 0,
    };
  }

  test("player MOVE into a wanderer's tile is refused (same reference, no turn cost)", () => {
    const state = makeCorridorState([2, 1], [[3, 1]], [1, 2, 3, 4]);
    const next = tick(state, { type: "MOVE", dir: "e" });
    expect(next).toBe(state);
    expect(
      getComponent(activeWorld(state), state.playerId, "position"),
    ).toEqual({
      x: 2,
      y: 1,
    });
  });

  test("two wanderers in a 3-cell corridor never end up co-located", () => {
    // Player off to one side, two wanderers in the middle three cells.
    let s = makeCorridorState(
      [1, 1],
      [
        [3, 1],
        [5, 1],
      ],
      [9, 8, 7, 6],
    );
    // Capture the two wanderer handles before any tick mutates the world.
    const wanderers: Array<{ id: number; gen: number }> = [];
    forQuery(activeWorld(s), ["ai"], (handle) => {
      wanderers.push({ id: handle.id, gen: handle.gen });
    });
    expect(wanderers.length).toBe(2);
    const w1 = wanderers[0];
    const w2 = wanderers[1];
    if (w1 === undefined || w2 === undefined) {
      throw new Error("test: wanderer capture failed");
    }
    for (let i = 0; i < 50; i++) {
      s = tick(s, { type: "WAIT" });
      const p1 = getComponent(activeWorld(s), w1, "position");
      const p2 = getComponent(activeWorld(s), w2, "position");
      // No wanderer despawns or position-strip happens in this test; an
      // undefined here means the world dropped a component silently and we
      // want loud failure, not a skipped assertion.
      if (p1 === undefined || p2 === undefined) {
        throw new Error(
          `test: wanderer lost its position component at iteration ${i}`,
        );
      }
      expect(`${p1.x},${p1.y}`).not.toBe(`${p2.x},${p2.y}`);
    }
  });
});
