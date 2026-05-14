import { describe, expect, test } from "bun:test";
import type { Level } from "../../dungeon/index";
import { getTile, TILE_FLOOR } from "../../dungeon/index";
import {
  despawn,
  emptyWorld,
  getComponent,
  type Position,
  removeComponent,
  spawn,
} from "../../ecs/index";
import type { RngState } from "../../rng/index";
import { emptyScheduler, schedule } from "../../scheduler/index";
import type { GameState } from "../state";
import { newGame } from "../state";
import { tick } from "../tick";

function makeLevel(w: number, h: number, tiles: Uint8Array): Level {
  return {
    grid: { width: w, height: h, tiles },
    rooms: [],
    spawn: null,
    downStairs: null,
  };
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
  const playerId = spawn(world, { position: { x, y } });
  const scheduler = emptyScheduler();
  schedule(scheduler, 0, playerId);
  return { level, world, playerId, scheduler, rngState, turn: 0 };
}

function playerPos(s: GameState): Position {
  const p = getComponent(s.world, s.playerId, "position");
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

  test("valid move preserves level, rngState, world, playerId, scheduler by reference", () => {
    const state = makeState(makeBoxLevel(), 2, 2);
    const next = tick(state, { type: "MOVE", dir: "e" });
    expect(next.level).toBe(state.level);
    expect(next.rngState).toBe(state.rngState);
    // World and scheduler are mutated in place — same reference, updated contents.
    expect(next.world).toBe(state.world);
    expect(next.scheduler).toBe(state.scheduler);
    expect(next.playerId).toBe(state.playerId);
  });

  test("throws specifically about missing position when the component was removed", () => {
    const state = makeState(makeBoxLevel(), 2, 2);
    removeComponent(state.world, state.playerId, "position");
    expect(() => tick(state, { type: "MOVE", dir: "n" })).toThrow(
      /missing the position component/,
    );
  });

  test("throws specifically about a stale handle when the player has been despawned", () => {
    const state = makeState(makeBoxLevel(), 2, 2);
    despawn(state.world, state.playerId);
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
    expect(next.scheduler.now).toBe(0);
    expect(next.scheduler.heap.length).toBe(1);
    expect(next.scheduler.heap[0]?.time).toBe(100);
    expect(next.scheduler.heap[0]?.handle).toEqual(state.playerId);
  });

  test("a refused move does not consume the player's turn slot", () => {
    const state = makeState(makeBoxLevel(), 2, 1); // 2,1 is interior; (2,0) is wall
    const before = state.scheduler.heap[0];
    if (before === undefined) {
      throw new Error("test setup: scheduler heap should not be empty");
    }
    const next = tick(state, { type: "MOVE", dir: "n" });
    expect(next).toBe(state);
    expect(state.scheduler.heap.length).toBe(1);
    expect(state.scheduler.heap[0]).toEqual(before);
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
    expect(next.scheduler.now).toBe(0);
    expect(next.scheduler.heap.length).toBe(1);
    expect(next.scheduler.heap[0]?.time).toBe(100);
  });

  test("consecutive WAITs advance scheduler.now by one turn each", () => {
    let state = makeState(makeBoxLevel(), 2, 2);
    state = tick(state, { type: "WAIT" });
    expect(state.scheduler.now).toBe(0);
    state = tick(state, { type: "WAIT" });
    expect(state.scheduler.now).toBe(100);
    state = tick(state, { type: "WAIT" });
    expect(state.scheduler.now).toBe(200);
  });
});

describe("newGame", () => {
  test("places the player at the spawn point", () => {
    const state = newGame(42, "rim");
    const spawnPt = state.level.spawn;
    expect(spawnPt).not.toBeNull();
    if (spawnPt !== null) {
      const pos = playerPos(state);
      expect(pos.x).toBe(spawnPt[0]);
      expect(pos.y).toBe(spawnPt[1]);
    }
  });

  test("starts at turn 0", () => {
    expect(newGame(42, "rim").turn).toBe(0);
    expect(newGame(7, "caverns").turn).toBe(0);
  });

  test("spawn is a floor tile", () => {
    for (const seed of [0, 1, 42, 0xdead, 0xbeef]) {
      const styles: Array<"rim" | "caverns"> = ["rim", "caverns"];
      for (const style of styles) {
        const state = newGame(seed, style);
        const pos = playerPos(state);
        expect(getTile(state.level.grid, pos.x, pos.y)).toBe(TILE_FLOOR);
      }
    }
  });

  test("two different seeds produce different levels", () => {
    const a = newGame(1, "rim");
    const b = newGame(2, "rim");
    expect(Array.from(a.level.grid.tiles)).not.toEqual(
      Array.from(b.level.grid.tiles),
    );
  });

  test("player entity carries actor and hp components", () => {
    const state = newGame(42, "rim");
    const actor = getComponent(state.world, state.playerId, "actor");
    const hp = getComponent(state.world, state.playerId, "hp");
    expect(actor).toEqual({ glyph: "@", name: "you" });
    expect(hp).toEqual({ current: 10, max: 10 });
  });
});
