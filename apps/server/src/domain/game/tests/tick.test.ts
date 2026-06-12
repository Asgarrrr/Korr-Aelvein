import { describe, expect, test } from "bun:test";
import type { Level } from "../../dungeon/index";
import { getTile, TILE_FLOOR } from "../../dungeon/index";
import {
  despawn,
  emptyWorld,
  forQuery,
  getComponent,
  isLiveHandle,
  type Position,
  removeComponent,
  setComponent,
  spawn,
} from "../../ecs/index";
import type { RngState } from "../../rng/index";
import { emptyScheduler, schedule, size } from "../../scheduler/index";
import {
  activeLevel,
  activeWorld,
  type GameState,
  type GlobalEvent,
  newGame,
  tick,
  type ZoneId,
  type ZoneStatus,
} from "../index";

const DONJON_ZONE: ZoneId = 0;

function makeLevel(w: number, h: number, tiles: Uint8Array): Level {
  return {
    grid: { width: w, height: h, tiles },
    rooms: [],
    spawn: null,
    downStairs: null,
  };
}

// Blank perception masks for hand-built ZoneStatus literals. The tests in
// this file exercise the tick loop, not perception — fog starts empty.
function makeFog(level: Level): { seen: Uint8Array; visible: Uint8Array } {
  const size = level.grid.width * level.grid.height;
  return { seen: new Uint8Array(size), visible: new Uint8Array(size) };
}

// 5x5 grid: wall border, 3x3 floor interior.
function makeBoxLevel(): Level {
  const W = 5;
  const H = 5;
  const tiles = new Uint8Array(W * H);
  for (let y = 1; y < 4; y++) {
    for (let x = 1; x < 4; x++) {
      tiles[y * W + x] = TILE_FLOOR;
    }
  }
  return makeLevel(W, H, tiles);
}

function makeState(level: Level, x: number, y: number): GameState {
  const rngState: RngState = [1, 2, 3, 4];
  const world = emptyWorld();
  const playerId = spawn(world, {
    position: { x, y },
    actor: { glyph: "@", name: "you" },
    hp: { current: 10, max: 10 },
  });
  const globalScheduler = emptyScheduler<GlobalEvent>();
  schedule(globalScheduler, 0, {
    kind: "actor",
    zone: DONJON_ZONE,
    entity: playerId,
  });
  const zones = new Map<ZoneId, ZoneStatus>();
  zones.set(DONJON_ZONE, { kind: "active", world, level, ...makeFog(level) });
  return {
    zones,
    activeZone: DONJON_ZONE,
    playerId,
    globalScheduler,
    rngState,
    time: 0,
    turn: 0,
    gameOver: false,
  };
}

function playerPos(s: GameState): Position {
  const p = getComponent(activeWorld(s), s.playerId, "position");
  if (p === undefined) {
    throw new Error("test: player entity has no position");
  }
  return p;
}

describe("tick: MOVE", () => {
  test("moves the player to an adjacent floor tile and increments turn", () => {
    const state = makeState(makeBoxLevel(), 2, 2);
    const next = tick(state, { type: "MOVE", dir: "n" });
    expect(playerPos(next)).toEqual({ x: 2, y: 1 });
    expect(next.turn).toBe(1);
  });

  test("does not move into a wall, does not increment turn, returns same reference", () => {
    const state = makeState(makeBoxLevel(), 2, 1);
    const next = tick(state, { type: "MOVE", dir: "n" });
    expect(playerPos(next)).toEqual({ x: 2, y: 1 });
    expect(next.turn).toBe(0);
    expect(next).toBe(state);
  });

  test("does not move out of bounds, does not increment turn, returns same reference", () => {
    const tiles = new Uint8Array(9).fill(TILE_FLOOR);
    const state = makeState(makeLevel(3, 3, tiles), 0, 0);
    const next = tick(state, { type: "MOVE", dir: "n" });
    expect(playerPos(next)).toEqual({ x: 0, y: 0 });
    expect(next.turn).toBe(0);
    expect(next).toBe(state);
  });

  test("all four directions move correctly from center", () => {
    const cases: Array<{ dir: "n" | "e" | "s" | "w"; x: number; y: number }> = [
      { dir: "n", x: 2, y: 1 },
      { dir: "e", x: 3, y: 2 },
      { dir: "s", x: 2, y: 3 },
      { dir: "w", x: 1, y: 2 },
    ];
    for (const { dir, x, y } of cases) {
      // Fresh state per case — the world is mutated by tick, so we can't
      // reuse a single level/state across iterations.
      const state = makeState(makeBoxLevel(), 2, 2);
      const next = tick(state, { type: "MOVE", dir });
      expect(playerPos(next)).toEqual({ x, y });
      expect(next.turn).toBe(1);
    }
  });

  test("valid move preserves zones, scheduler, playerId by reference; rngState value-equal when no rolls happen", () => {
    const state = makeState(makeBoxLevel(), 2, 2);
    const next = tick(state, { type: "MOVE", dir: "e" });
    // The zones map and the active zone's world+level are mutated in place
    // via the scheduler / setComponent paths — same reference, updated contents.
    expect(next.zones).toBe(state.zones);
    expect(activeLevel(next)).toBe(activeLevel(state));
    expect(activeWorld(next)).toBe(activeWorld(state));
    expect(next.globalScheduler).toBe(state.globalScheduler);
    expect(next.playerId).toBe(state.playerId);
    // rngState is re-snapshotted every tick (fresh tuple), so identity drifts,
    // but value stays equal when MOVE doesn't roll (no other AIs in this state).
    expect(next.rngState).toEqual(state.rngState);
  });

  test("throws specifically about missing position when the component was removed", () => {
    const state = makeState(makeBoxLevel(), 2, 2);
    removeComponent(activeWorld(state), state.playerId, "position");
    expect(() => tick(state, { type: "MOVE", dir: "n" })).toThrow(
      /missing the position component/,
    );
  });

  test("throws specifically about a stale handle when the player has been despawned", () => {
    const state = makeState(makeBoxLevel(), 2, 2);
    despawn(activeWorld(state), state.playerId);
    expect(() => tick(state, { type: "MOVE", dir: "n" })).toThrow(
      /player handle is stale/,
    );
  });

  test("consecutive moves accumulate turn count correctly", () => {
    let state = makeState(makeBoxLevel(), 2, 2);
    state = tick(state, { type: "MOVE", dir: "n" }); // (2,1)
    state = tick(state, { type: "MOVE", dir: "e" }); // (3,1)
    state = tick(state, { type: "MOVE", dir: "s" }); // (3,2)
    state = tick(state, { type: "MOVE", dir: "w" }); // (2,2)
    expect(playerPos(state)).toEqual({ x: 2, y: 2 });
    expect(state.turn).toBe(4);
  });

  test("a valid move re-schedules the player one turn later", () => {
    const state = makeState(makeBoxLevel(), 2, 2);
    const next = tick(state, { type: "MOVE", dir: "n" });
    // After tick: pop player@0 → now=0, schedule player@100.
    expect(next.globalScheduler.now).toBe(0);
    expect(next.globalScheduler.heap.length).toBe(1);
    const head = next.globalScheduler.heap[0];
    expect(head?.time).toBe(100);
    expect(head?.payload.kind).toBe("actor");
    if (head?.payload.kind === "actor") {
      expect(head.payload.entity).toEqual(state.playerId);
      expect(head.payload.zone).toBe(state.activeZone);
    }
  });

  test("a refused move does not consume the player's turn slot", () => {
    const state = makeState(makeBoxLevel(), 2, 1); // 2,1 is interior; (2,0) is wall
    const before = state.globalScheduler.heap[0];
    if (before === undefined) {
      throw new Error("test setup: scheduler heap should not be empty");
    }
    const next = tick(state, { type: "MOVE", dir: "n" });
    expect(next).toBe(state);
    expect(state.globalScheduler.heap.length).toBe(1);
    expect(state.globalScheduler.heap[0]).toEqual(before);
  });
});

describe("tick: bump-combat", () => {
  function makeArenaState(): GameState {
    // 5x5 box, player at (2,2), wanderer at (3,2). The player can MOVE east
    // to bump-attack; nothing else inhabits the world.
    const world = emptyWorld();
    const playerId = spawn(world, {
      position: { x: 2, y: 2 },
      actor: { glyph: "@", name: "you" },
      hp: { current: 10, max: 10 },
    });
    const wanderer = spawn(world, {
      position: { x: 3, y: 2 },
      actor: { glyph: "r", name: "wanderer" },
      ai: { kind: "wanderer" },
      hp: { current: 3, max: 3 },
    });
    const globalScheduler = emptyScheduler<GlobalEvent>();
    schedule(globalScheduler, 0, {
      kind: "actor",
      zone: DONJON_ZONE,
      entity: playerId,
    });
    // Wanderer scheduled far in the future so the test's single tick can
    // never trigger the AI dispatch — we want to isolate the player's MOVE
    // semantics, not interleave random wanderer behaviour.
    schedule(globalScheduler, 1_000_000, {
      kind: "actor",
      zone: DONJON_ZONE,
      entity: wanderer,
    });
    const zones = new Map<ZoneId, ZoneStatus>();
    const level = makeBoxLevel();
    zones.set(DONJON_ZONE, {
      kind: "active",
      world,
      level,
      ...makeFog(level),
    });
    return {
      zones,
      activeZone: DONJON_ZONE,
      playerId,
      globalScheduler,
      rngState: [1, 2, 3, 4],
      time: 0,
      turn: 0,
      gameOver: false,
    };
  }

  test("MOVE into a wanderer's tile deals damage instead of moving", () => {
    const state = makeArenaState();
    let wanderer: { id: number; gen: number } | undefined;
    forQuery(activeWorld(state), ["ai"], (h) => {
      if (wanderer === undefined) wanderer = { id: h.id, gen: h.gen };
    });
    if (wanderer === undefined) throw new Error("test: wanderer not found");
    const beforeHp = getComponent(activeWorld(state), wanderer, "hp");
    expect(beforeHp?.current).toBe(3);
    const next = tick(state, { type: "MOVE", dir: "e" });
    expect(playerPos(next)).toEqual({ x: 2, y: 2 });
    expect(next.turn).toBe(1);
    const afterHp = getComponent(activeWorld(next), wanderer, "hp");
    expect(afterHp?.current).toBeLessThan(3);
    expect(afterHp?.current).toBeGreaterThanOrEqual(0);
  });

  test("killing a wanderer via MOVE despawns it and lazy-skips its heap slot", () => {
    let state = makeArenaState();
    // Drop wanderer hp to 1 so any roll kills it.
    let wanderer: { id: number; gen: number } | undefined;
    forQuery(activeWorld(state), ["ai"], (h) => {
      if (wanderer === undefined) wanderer = { id: h.id, gen: h.gen };
    });
    if (wanderer === undefined) throw new Error("test: wanderer not found");
    setComponent(activeWorld(state), wanderer, "hp", { current: 1, max: 3 });
    state = tick(state, { type: "MOVE", dir: "e" });
    expect(isLiveHandle(activeWorld(state), wanderer)).toBe(false);
    expect(state.gameOver).toBe(false);
  });

  test("gameOver becomes true once the player's hp reaches zero", () => {
    const state = makeArenaState();
    // Pre-set hp to zero (whatever inflicted the damage isn't the point of
    // this test — the bump-attack path is covered by the "damage instead
    // of moving" test above). The end-of-tick `playerIsDead` check is what
    // we want to exercise.
    setComponent(activeWorld(state), state.playerId, "hp", {
      current: 0,
      max: 10,
    });
    expect(state.gameOver).toBe(false);
    const next = tick(state, { type: "WAIT" });
    expect(next.gameOver).toBe(true);
  });

  test("after gameOver, further tick calls throw", () => {
    const state = makeArenaState();
    const dead: GameState = { ...state, gameOver: true };
    expect(() => tick(dead, { type: "WAIT" })).toThrow(/run is over/);
  });

  test("drain fires every event at the dead player's timestamp (no short-circuit)", () => {
    // Two wanderers and a hp=0 player all scheduled at time 0. After one
    // tick, `gameOver` must be set AND both wanderers must have rolled
    // their direction (rngState advances; both stay rescheduled).
    // This pins the "drain finishes its timestamp regardless of player
    // death" invariant that replaced the old short-circuit in Phase 5.
    const world = emptyWorld();
    const playerId = spawn(world, {
      position: { x: 2, y: 2 },
      actor: { glyph: "@", name: "you" },
      hp: { current: 0, max: 10 }, // pre-dead, gameOver computed at tick end
    });
    const wa = spawn(world, {
      position: { x: 3, y: 2 },
      actor: { glyph: "r", name: "wA" },
      ai: { kind: "wanderer" },
      hp: { current: 3, max: 3 },
    });
    const wb = spawn(world, {
      position: { x: 1, y: 2 },
      actor: { glyph: "r", name: "wB" },
      ai: { kind: "wanderer" },
      hp: { current: 3, max: 3 },
    });
    const globalScheduler = emptyScheduler<GlobalEvent>();
    schedule(globalScheduler, 0, {
      kind: "actor",
      zone: DONJON_ZONE,
      entity: playerId,
    });
    schedule(globalScheduler, 0, {
      kind: "actor",
      zone: DONJON_ZONE,
      entity: wa,
    });
    schedule(globalScheduler, 0, {
      kind: "actor",
      zone: DONJON_ZONE,
      entity: wb,
    });
    const zones = new Map<ZoneId, ZoneStatus>();
    const level = makeBoxLevel();
    zones.set(DONJON_ZONE, {
      kind: "active",
      world,
      level,
      ...makeFog(level),
    });
    const rngBefore: RngState = [1, 2, 3, 4];
    const state: GameState = {
      zones,
      activeZone: DONJON_ZONE,
      playerId,
      globalScheduler,
      rngState: rngBefore,
      time: 0,
      turn: 0,
      gameOver: false,
    };
    const next = tick(state, { type: "WAIT" });
    expect(next.gameOver).toBe(true);
    // Both wanderers consumed their direction roll → rngState diverged.
    expect(next.rngState).not.toEqual(rngBefore);
    // Both wanderers rescheduled at t=100 alongside the player → heap
    // size still 3. If the drain had aborted on player death, the second
    // wanderer would be left on the heap at t=0.
    expect(size(next.globalScheduler)).toBe(3);
    for (const ev of next.globalScheduler.heap) {
      expect(ev.time).toBe(100);
    }
  });
});

describe("tick: WAIT", () => {
  test("WAIT leaves position untouched and increments turn", () => {
    const state = makeState(makeBoxLevel(), 2, 2);
    const next = tick(state, { type: "WAIT" });
    expect(playerPos(next)).toEqual({ x: 2, y: 2 });
    expect(next.turn).toBe(1);
  });

  test("WAIT re-schedules the player one turn later", () => {
    const state = makeState(makeBoxLevel(), 2, 2);
    const next = tick(state, { type: "WAIT" });
    expect(next.globalScheduler.now).toBe(0);
    expect(next.globalScheduler.heap.length).toBe(1);
    expect(next.globalScheduler.heap[0]?.time).toBe(100);
  });

  test("consecutive WAITs advance state.time by one turn each", () => {
    let state = makeState(makeBoxLevel(), 2, 2);
    state = tick(state, { type: "WAIT" });
    expect(state.time).toBe(0);
    state = tick(state, { type: "WAIT" });
    expect(state.time).toBe(100);
    state = tick(state, { type: "WAIT" });
    expect(state.time).toBe(200);
  });
});

describe("newGame", () => {
  test("places the player at the spawn point", () => {
    const state = newGame(42, "rim");
    const spawnPt = activeLevel(state).spawn;
    expect(spawnPt).not.toBeNull();
    if (spawnPt !== null) {
      const pos = playerPos(state);
      expect(pos.x).toBe(spawnPt[0]);
      expect(pos.y).toBe(spawnPt[1]);
    }
  });

  test("starts at turn 0 and time 0", () => {
    const a = newGame(42, "rim");
    expect(a.turn).toBe(0);
    expect(a.time).toBe(0);
    const b = newGame(7, "caverns");
    expect(b.turn).toBe(0);
    expect(b.time).toBe(0);
  });

  test("spawn is a floor tile", () => {
    for (const seed of [0, 1, 42, 0xdead, 0xbeef]) {
      const styles: Array<"rim" | "caverns"> = ["rim", "caverns"];
      for (const style of styles) {
        const state = newGame(seed, style);
        const pos = playerPos(state);
        expect(getTile(activeLevel(state).grid, pos.x, pos.y)).toBe(TILE_FLOOR);
      }
    }
  });

  test("two different seeds produce different levels", () => {
    const a = newGame(1, "rim");
    const b = newGame(2, "rim");
    expect(Array.from(activeLevel(a).grid.tiles)).not.toEqual(
      Array.from(activeLevel(b).grid.tiles),
    );
  });

  test("player entity carries actor and hp components", () => {
    const state = newGame(42, "rim");
    const world = activeWorld(state);
    const actor = getComponent(world, state.playerId, "actor");
    const hp = getComponent(world, state.playerId, "hp");
    expect(actor).toEqual({ glyph: "@", name: "you" });
    expect(hp).toEqual({ current: 10, max: 10 });
  });

  test("zones map holds donjon (active) + village (dormant); activeZone is donjon", () => {
    const state = newGame(42, "rim");
    expect(state.zones.size).toBe(2);
    const donjon = state.zones.get(state.activeZone);
    expect(donjon?.kind).toBe("active");
    // The village id (1) is implementation-private; iterate the map to find
    // the non-active zone rather than hard-coding it.
    let dormantCount = 0;
    for (const z of state.zones.values()) {
      if (z.kind === "dormant") dormantCount += 1;
    }
    expect(dormantCount).toBe(1);
  });

  test("`state.zones` is intentionally not JSON-safe (regression pin)", () => {
    // `Map` round-trips through JSON as `{}`. A naive `JSON.stringify(state)`
    // for save/replay would lose every zone. Phase 5+ save API must use
    // `Array.from(state.zones)` and reconstruct with `new Map(entries)`.
    // This test exists to make the failure mode visible in code rather
    // than discovering it the day the save bug ships.
    const state = newGame(42, "rim");
    const roundTripped = JSON.parse(JSON.stringify(state));
    expect(roundTripped.zones).toEqual({});
    const explicit = Array.from(state.zones.entries());
    expect(explicit.length).toBe(state.zones.size);
  });
});
