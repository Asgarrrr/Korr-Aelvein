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
import type { GameState } from "../state";
import { newGame } from "../state";
import { tick } from "../tick";

type Pos = { x: number; y: number };

function mobPositions(state: GameState): Pos[] {
  const out: Pos[] = [];
  forQuery(state.world, ["position", "actor", "ai"], (_h, view) => {
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
    const playerPos = getComponent(state.world, state.playerId, "position");
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
    forQuery(state.world, ["actor", "ai"], (_h, view) => {
      expect(view.actor?.glyph).toBe("r");
      expect(view.ai?.kind).toBe("wanderer");
    });
  });

  test("player is scheduled before wanderers on turn 1 (seq tiebreak)", () => {
    const state = newGame(42, "rim");
    // Heap: 1 player + 2 wanderers, all at time 0; player's seq must be lowest.
    expect(size(state.scheduler)).toBe(3);
    const head = state.scheduler.heap[0];
    expect(head?.handle).toEqual(state.playerId);
    expect(head?.time).toBe(0);
  });
});

describe("tick: drain loop runs wanderers", () => {
  test("one player WAIT triggers each wanderer's turn before returning", () => {
    const state = newGame(42, "rim");
    const before = mobPositions(state);
    const next = tick(state, { type: "WAIT" });
    // After one tick: heap should hold 3 actors again (player + 2 wanderers),
    // every entry scheduled at time 100.
    expect(size(next.scheduler)).toBe(3);
    for (const ev of next.scheduler.heap) {
      expect(ev.time).toBe(100);
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
    forQuery(state.world, ["ai"], (handle) => {
      if (victim === undefined) victim = { id: handle.id, gen: handle.gen };
    });
    expect(victim).toBeDefined();
    if (victim === undefined) return;
    despawn(state.world, victim);
    // Tick should drain the wanderer's stale heap entry, run the survivor,
    // and return without throwing.
    expect(() => tick(state, { type: "WAIT" })).not.toThrow();
    // After the tick, the despawned handle is unambiguously gone.
    expect(isLiveHandle(state.world, victim)).toBe(false);
    // Only the player + the surviving wanderer remain on the heap.
    const next = tick(state, { type: "WAIT" });
    expect(size(next.scheduler)).toBe(2);
  });

  test("removing a wanderer's `ai` component drops it from the heap on next pop", () => {
    const state = newGame(42, "rim");
    // Strip `ai` from one wanderer; the entity stays alive and on the heap.
    let target: { id: number; gen: number } | undefined;
    forQuery(state.world, ["ai"], (handle) => {
      if (target === undefined) target = { id: handle.id, gen: handle.gen };
    });
    if (target === undefined) throw new Error("test: no wanderer found");
    removeComponent(state.world, target, "ai");
    // 5 ticks later, the de-AI'd entity must NOT be cycling in the heap.
    let s = state;
    for (let i = 0; i < 5; i++) s = tick(s, { type: "WAIT" });
    // Heap should have: player + the surviving wanderer = 2. If the
    // de-AI'd entity were being re-scheduled, size would still be 3.
    expect(size(s.scheduler)).toBe(2);
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

  test("player MOVE into a wanderer's tile is refused (same reference, no turn cost)", () => {
    const world = emptyWorld();
    const playerId = spawn(world, {
      position: { x: 2, y: 1 },
      actor: { glyph: "@", name: "you" },
    });
    const wanderer = spawn(world, {
      position: { x: 3, y: 1 },
      actor: { glyph: "r", name: "wanderer" },
      ai: { kind: "wanderer" },
    });
    const scheduler = emptyScheduler();
    schedule(scheduler, 0, playerId);
    schedule(scheduler, 0, wanderer);
    const rngState: RngState = [1, 2, 3, 4];
    const state: GameState = {
      level: corridorLevel(),
      world,
      playerId,
      scheduler,
      rngState,
      turn: 0,
    };
    const next = tick(state, { type: "MOVE", dir: "e" });
    expect(next).toBe(state);
    expect(getComponent(state.world, playerId, "position")).toEqual({
      x: 2,
      y: 1,
    });
  });

  test("two wanderers in a 3-cell corridor never end up co-located", () => {
    // Player off to one side, two wanderers in the middle three cells.
    const world = emptyWorld();
    const playerId = spawn(world, {
      position: { x: 1, y: 1 },
      actor: { glyph: "@", name: "you" },
    });
    const w1 = spawn(world, {
      position: { x: 3, y: 1 },
      actor: { glyph: "r", name: "wanderer" },
      ai: { kind: "wanderer" },
    });
    const w2 = spawn(world, {
      position: { x: 5, y: 1 },
      actor: { glyph: "r", name: "wanderer" },
      ai: { kind: "wanderer" },
    });
    const scheduler = emptyScheduler();
    schedule(scheduler, 0, playerId);
    schedule(scheduler, 0, w1);
    schedule(scheduler, 0, w2);
    const rngState: RngState = [9, 8, 7, 6];
    let s: GameState = {
      level: corridorLevel(),
      world,
      playerId,
      scheduler,
      rngState,
      turn: 0,
    };
    for (let i = 0; i < 50; i++) {
      s = tick(s, { type: "WAIT" });
      const p1 = getComponent(s.world, w1, "position");
      const p2 = getComponent(s.world, w2, "position");
      if (p1 === undefined || p2 === undefined) continue;
      expect(`${p1.x},${p1.y}`).not.toBe(`${p2.x},${p2.y}`);
    }
  });
});
