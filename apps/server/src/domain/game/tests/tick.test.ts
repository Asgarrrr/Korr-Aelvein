import { describe, expect, test } from "bun:test";
import type { Level } from "../../dungeon/index";
import { getTile, TILE_FLOOR } from "../../dungeon/index";
import type { RngState } from "../../rng/index";
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
  return { level, player: { x, y }, rngState, turn: 0 };
}

describe("tick: MOVE", () => {
  test("moves the player to an adjacent floor tile and increments turn", () => {
    const state = makeState(makeBoxLevel(), 2, 2);
    const next = tick(state, { type: "MOVE", dir: "n" });
    expect(next.player).toEqual({ x: 2, y: 1 });
    expect(next.turn).toBe(1);
  });

  test("does not move into a wall, does not increment turn, returns same reference", () => {
    const state = makeState(makeBoxLevel(), 2, 1);
    const next = tick(state, { type: "MOVE", dir: "n" });
    expect(next.player).toEqual({ x: 2, y: 1 });
    expect(next.turn).toBe(0);
    expect(next).toBe(state);
  });

  test("does not move out of bounds, does not increment turn, returns same reference", () => {
    const tiles = new Uint8Array(9).fill(TILE_FLOOR);
    const state = makeState(makeLevel(3, 3, tiles), 0, 0);
    const next = tick(state, { type: "MOVE", dir: "n" });
    expect(next.player).toEqual({ x: 0, y: 0 });
    expect(next.turn).toBe(0);
    expect(next).toBe(state);
  });

  test("all four directions move correctly from center", () => {
    const level = makeBoxLevel();
    const cases: Array<{ dir: "n" | "e" | "s" | "w"; x: number; y: number }> = [
      { dir: "n", x: 2, y: 1 },
      { dir: "e", x: 3, y: 2 },
      { dir: "s", x: 2, y: 3 },
      { dir: "w", x: 1, y: 2 },
    ];
    for (const { dir, x, y } of cases) {
      const state = makeState(level, 2, 2);
      const next = tick(state, { type: "MOVE", dir });
      expect(next.player).toEqual({ x, y });
      expect(next.turn).toBe(1);
    }
  });

  test("valid move preserves level and rngState by reference", () => {
    const state = makeState(makeBoxLevel(), 2, 2);
    const next = tick(state, { type: "MOVE", dir: "e" });
    expect(next.level).toBe(state.level);
    expect(next.rngState).toBe(state.rngState);
  });

  test("consecutive moves accumulate turn count correctly", () => {
    let state = makeState(makeBoxLevel(), 2, 2);
    state = tick(state, { type: "MOVE", dir: "n" }); // (2,1)
    state = tick(state, { type: "MOVE", dir: "e" }); // (3,1)
    state = tick(state, { type: "MOVE", dir: "s" }); // (3,2)
    state = tick(state, { type: "MOVE", dir: "w" }); // (2,2)
    expect(state.player).toEqual({ x: 2, y: 2 });
    expect(state.turn).toBe(4);
  });
});

describe("newGame", () => {
  test("places the player at the spawn point", () => {
    const state = newGame(42, "rim");
    const spawn = state.level.spawn;
    expect(spawn).not.toBeNull();
    if (spawn !== null) {
      expect(state.player.x).toBe(spawn[0]);
      expect(state.player.y).toBe(spawn[1]);
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
        const { level, player } = newGame(seed, style);
        expect(getTile(level.grid, player.x, player.y)).toBe(TILE_FLOOR);
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
});
