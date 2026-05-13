import { describe, expect, test } from "bun:test";
import {
  cloneTiles,
  fillBorder,
  getTile,
  idx,
  inBounds,
  makeBfsScratch,
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

describe("getTile", () => {
  test("reads back what was written directly into tiles[idx]", () => {
    const g = makeGrid(5, 4);
    g.tiles[idx(2, 3, 5)] = TILE_FLOOR;
    expect(getTile(g, 2, 3)).toBe(TILE_FLOOR);
  });

  test("throws on out-of-bounds", () => {
    const g = makeGrid(5, 4);
    expect(() => getTile(g, -1, 0)).toThrow();
    expect(() => getTile(g, 0, -1)).toThrow();
    expect(() => getTile(g, 5, 0)).toThrow();
    expect(() => getTile(g, 0, 4)).toThrow();
  });

  test("throws when underlying byte is not a known tile", () => {
    const g = makeGrid(2, 2);
    g.tiles[0] = 99;
    expect(() => getTile(g, 0, 0)).toThrow();
  });

  test("recognises all three valid tile values", () => {
    const g = makeGrid(1, 1);
    expect(getTile(g, 0, 0)).toBe(TILE_WALL);
    g.tiles[0] = TILE_FLOOR;
    expect(getTile(g, 0, 0)).toBe(TILE_FLOOR);
    g.tiles[0] = TILE_DOOR;
    expect(getTile(g, 0, 0)).toBe(TILE_DOOR);
  });
});

describe("cloneTiles", () => {
  test("returns a fresh Uint8Array with the same bytes as the input", () => {
    const g = makeGrid(5, 4);
    g.tiles[0] = TILE_FLOOR;
    g.tiles[6] = TILE_DOOR;
    const { W, H, tiles, cap } = cloneTiles(g);
    expect(W).toBe(5);
    expect(H).toBe(4);
    expect(cap).toBe(20);
    expect(tiles.length).toBe(20);
    expect(tiles).not.toBe(g.tiles);
    expect(Array.from(tiles)).toEqual(Array.from(g.tiles));
  });

  test("mutating the returned tiles does not affect the input grid", () => {
    const g = makeGrid(3, 3);
    const { tiles } = cloneTiles(g);
    tiles.fill(TILE_FLOOR);
    for (const b of g.tiles) expect(b).toBe(TILE_WALL);
  });
});

describe("fillBorder", () => {
  test("on a 4x4 grid, writes exactly the 12 perimeter cells and leaves the 4 interior cells untouched", () => {
    const tiles = new Uint8Array(16);
    fillBorder(tiles, 4, 4, TILE_FLOOR);
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 4; x++) {
        const isBorder = x === 0 || x === 3 || y === 0 || y === 3;
        expect(tiles[idx(x, y, 4)]).toBe(isBorder ? TILE_FLOOR : TILE_WALL);
      }
    }
  });

  test("on a 1x4 (W=1) strip, every cell is on the border", () => {
    const tiles = new Uint8Array(4);
    fillBorder(tiles, 1, 4, TILE_FLOOR);
    for (let i = 0; i < 4; i++) expect(tiles[i]).toBe(TILE_FLOOR);
  });

  test("on a 4x1 (H=1) strip, every cell is on the border", () => {
    const tiles = new Uint8Array(4);
    fillBorder(tiles, 4, 1, TILE_FLOOR);
    for (let i = 0; i < 4; i++) expect(tiles[i]).toBe(TILE_FLOOR);
  });

  test("preserves interior contents when called on a partly-filled grid", () => {
    const tiles = new Uint8Array(16).fill(TILE_DOOR);
    fillBorder(tiles, 4, 4, TILE_WALL);
    // Interior cells (the four inner cells of a 4x4 grid) keep TILE_DOOR.
    expect(tiles[idx(1, 1, 4)]).toBe(TILE_DOOR);
    expect(tiles[idx(2, 1, 4)]).toBe(TILE_DOOR);
    expect(tiles[idx(1, 2, 4)]).toBe(TILE_DOOR);
    expect(tiles[idx(2, 2, 4)]).toBe(TILE_DOOR);
    // Perimeter cells flipped to TILE_WALL.
    expect(tiles[idx(0, 0, 4)]).toBe(TILE_WALL);
    expect(tiles[idx(3, 3, 4)]).toBe(TILE_WALL);
  });
});

describe("makeBfsScratch", () => {
  test("returns four buffers of the requested capacity, zero-initialised", () => {
    const cap = 25;
    const { visited, queueX, queueY, queueD } = makeBfsScratch(cap);
    expect(visited.length).toBe(cap);
    expect(queueX.length).toBe(cap);
    expect(queueY.length).toBe(cap);
    expect(queueD.length).toBe(cap);
    for (const b of visited) expect(b).toBe(0);
    for (const b of queueX) expect(b).toBe(0);
    for (const b of queueY) expect(b).toBe(0);
    for (const b of queueD) expect(b).toBe(0);
  });

  test("queues are Int32Array (signed) and visited is Uint8Array", () => {
    const { visited, queueX, queueY, queueD } = makeBfsScratch(1);
    expect(visited).toBeInstanceOf(Uint8Array);
    expect(queueX).toBeInstanceOf(Int32Array);
    expect(queueY).toBeInstanceOf(Int32Array);
    expect(queueD).toBeInstanceOf(Int32Array);
  });
});
