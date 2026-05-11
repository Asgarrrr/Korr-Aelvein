import { describe, expect, test } from "bun:test";
import {
  getTile,
  idx,
  inBounds,
  neighbors4,
  neighbors8,
  setTile,
} from "../grid";
import { type Grid, TILE_DOOR, TILE_FLOOR, TILE_WALL } from "../types";

function makeGrid(width: number, height: number): Grid {
  return { width, height, tiles: new Uint8Array(width * height) };
}

describe("idx", () => {
  test("width 1: idx(0, y, 1) === y", () => {
    for (let y = 0; y < 10; y++) expect(idx(0, y, 1)).toBe(y);
  });

  test("width 5: round-trips top-left, mid, and bottom-right", () => {
    expect(idx(0, 0, 5)).toBe(0);
    expect(idx(4, 0, 5)).toBe(4);
    expect(idx(0, 1, 5)).toBe(5);
    expect(idx(2, 3, 5)).toBe(17);
    expect(idx(4, 9, 5)).toBe(49);
  });

  test("width 80: every (x, y) maps to a unique index in the grid range", () => {
    const w = 80;
    const h = 30;
    const seen = new Set<number>();
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = idx(x, y, w);
        expect(i).toBeGreaterThanOrEqual(0);
        expect(i).toBeLessThan(w * h);
        seen.add(i);
      }
    }
    expect(seen.size).toBe(w * h);
  });
});

describe("inBounds", () => {
  const grid = { width: 5, height: 4 };

  test("corners are in bounds", () => {
    expect(inBounds(0, 0, grid)).toBe(true);
    expect(inBounds(4, 0, grid)).toBe(true);
    expect(inBounds(0, 3, grid)).toBe(true);
    expect(inBounds(4, 3, grid)).toBe(true);
  });

  test("just-outside is not in bounds", () => {
    expect(inBounds(5, 0, grid)).toBe(false);
    expect(inBounds(0, 4, grid)).toBe(false);
    expect(inBounds(5, 4, grid)).toBe(false);
  });

  test("negative coordinates are not in bounds", () => {
    expect(inBounds(-1, 0, grid)).toBe(false);
    expect(inBounds(0, -1, grid)).toBe(false);
    expect(inBounds(-1, -1, grid)).toBe(false);
  });
});

describe("getTile / setTile", () => {
  test("setTile then getTile returns the new tile", () => {
    const g = makeGrid(5, 4);
    const g2 = setTile(g, 2, 3, TILE_FLOOR);
    expect(getTile(g2, 2, 3)).toBe(TILE_FLOOR);
  });

  test("setTile does not mutate the input grid", () => {
    const g = makeGrid(5, 4);
    expect(getTile(g, 2, 3)).toBe(TILE_WALL);
    const g2 = setTile(g, 2, 3, TILE_DOOR);
    expect(getTile(g, 2, 3)).toBe(TILE_WALL);
    expect(getTile(g2, 2, 3)).toBe(TILE_DOOR);
    expect(g.tiles).not.toBe(g2.tiles);
  });

  test("setTile returns a grid with the same dimensions", () => {
    const g = makeGrid(7, 9);
    const g2 = setTile(g, 1, 1, TILE_FLOOR);
    expect(g2.width).toBe(7);
    expect(g2.height).toBe(9);
    expect(g2.tiles.length).toBe(63);
  });

  test("getTile throws on out-of-bounds", () => {
    const g = makeGrid(5, 4);
    expect(() => getTile(g, -1, 0)).toThrow();
    expect(() => getTile(g, 0, -1)).toThrow();
    expect(() => getTile(g, 5, 0)).toThrow();
    expect(() => getTile(g, 0, 4)).toThrow();
  });

  test("setTile throws on out-of-bounds", () => {
    const g = makeGrid(5, 4);
    expect(() => setTile(g, -1, 0, TILE_FLOOR)).toThrow();
    expect(() => setTile(g, 0, -1, TILE_FLOOR)).toThrow();
    expect(() => setTile(g, 5, 0, TILE_FLOOR)).toThrow();
    expect(() => setTile(g, 0, 4, TILE_FLOOR)).toThrow();
  });

  test("getTile throws when underlying byte is not a known tile", () => {
    const g = makeGrid(2, 2);
    g.tiles[0] = 99;
    expect(() => getTile(g, 0, 0)).toThrow();
  });

  test("getTile recognises all three valid tile values", () => {
    const g0 = makeGrid(1, 1);
    const g1 = setTile(g0, 0, 0, TILE_FLOOR);
    const g2 = setTile(g0, 0, 0, TILE_DOOR);
    expect(getTile(g0, 0, 0)).toBe(TILE_WALL);
    expect(getTile(g1, 0, 0)).toBe(TILE_FLOOR);
    expect(getTile(g2, 0, 0)).toBe(TILE_DOOR);
  });
});

describe("neighbors4", () => {
  test("returns exactly 4 entries", () => {
    expect(neighbors4(0, 0).length).toBe(4);
    expect(neighbors4(10, 10).length).toBe(4);
  });

  test("offsets are N, E, S, W of the input", () => {
    const ns = neighbors4(5, 7);
    expect(ns).toEqual([
      [5, 6],
      [6, 7],
      [5, 8],
      [4, 7],
    ]);
  });

  test("does not include the input cell or diagonals", () => {
    const ns = neighbors4(0, 0);
    for (const [nx, ny] of ns) {
      expect(nx === 0 && ny === 0).toBe(false);
      expect(Math.abs(nx) + Math.abs(ny)).toBe(1);
    }
  });
});

describe("neighbors8", () => {
  test("returns exactly 8 entries", () => {
    expect(neighbors8(0, 0).length).toBe(8);
    expect(neighbors8(10, 10).length).toBe(8);
  });

  test("excludes the input cell (0,0)", () => {
    const ns = neighbors8(0, 0);
    for (const [nx, ny] of ns) {
      expect(nx === 0 && ny === 0).toBe(false);
    }
  });

  test("includes the four diagonals", () => {
    const ns = neighbors8(5, 7);
    const set = new Set(ns.map(([x, y]) => `${x},${y}`));
    expect(set.has("4,6")).toBe(true);
    expect(set.has("6,6")).toBe(true);
    expect(set.has("4,8")).toBe(true);
    expect(set.has("6,8")).toBe(true);
  });

  test("entries are exactly the Moore neighborhood", () => {
    const ns = neighbors8(0, 0);
    const set = new Set(ns.map(([x, y]) => `${x},${y}`));
    expect(set).toEqual(
      new Set(["-1,-1", "0,-1", "1,-1", "-1,0", "1,0", "-1,1", "0,1", "1,1"]),
    );
  });
});
