// Foundation tests for symmetric shadowcasting: surface contract (mask
// shape, origin handling, throw on bad origin), opacity semantics (walls
// and doors block, floors don't), and hand-checkable geometry (pillar
// shadow, corridor occlusion, euclidean range cut).

import { describe, expect, test } from "bun:test";
import type { Level } from "../../dungeon/index";
import { TILE_DOOR, TILE_FLOOR, TILE_WALL } from "../../dungeon/index";
import { computeFov, isOpaque } from "../index";

/**
 * Build a Level from ASCII rows: `#` wall, `+` door, anything else floor.
 * Test-fixture mirror of the preview script's glyph mapping.
 */
function levelFrom(rows: ReadonlyArray<string>): Level {
  const height = rows.length;
  const first = rows[0];
  if (first === undefined) throw new Error("test: levelFrom needs rows");
  const width = first.length;
  const tiles = new Uint8Array(width * height);
  for (const [y, row] of rows.entries()) {
    if (row.length !== width) throw new Error("test: ragged rows");
    for (const [x, ch] of [...row].entries()) {
      tiles[y * width + x] =
        ch === "#" ? TILE_WALL : ch === "+" ? TILE_DOOR : TILE_FLOOR;
    }
  }
  return {
    grid: { width, height, tiles },
    rooms: [],
    spawn: null,
    downStairs: null,
  };
}

function at(mask: Uint8Array, level: Level, x: number, y: number): number {
  const v = mask[y * level.grid.width + x];
  if (v === undefined) throw new Error(`test: mask read out of bounds`);
  return v;
}

describe("isOpaque", () => {
  test("walls and doors block sight, floors do not", () => {
    expect(isOpaque(TILE_WALL)).toBe(true);
    expect(isOpaque(TILE_DOOR)).toBe(true);
    expect(isOpaque(TILE_FLOOR)).toBe(false);
  });
});

describe("computeFov — surface contract", () => {
  test("mask has width × height entries, all 0 or 1", () => {
    const level = levelFrom(["....", "....", "...."]);
    const mask = computeFov(level, 1, 1, 8);
    expect(mask.length).toBe(12);
    for (const v of mask) {
      expect([0, 1]).toContain(v);
    }
  });

  test("origin is always visible, even from inside solid rock", () => {
    const level = levelFrom(["###", "###", "###"]);
    const mask = computeFov(level, 1, 1, 4);
    expect(at(mask, level, 1, 1)).toBe(1);
  });

  test("throws when the origin is out of bounds", () => {
    const level = levelFrom(["...", "..."]);
    expect(() => computeFov(level, -1, 0, 4)).toThrow(/out of bounds/);
    expect(() => computeFov(level, 3, 0, 4)).toThrow(/out of bounds/);
    expect(() => computeFov(level, 0, 2, 4)).toThrow(/out of bounds/);
  });

  test("radius 0 reveals only the origin", () => {
    const level = levelFrom([".....", ".....", "....."]);
    const mask = computeFov(level, 2, 1, 0);
    let count = 0;
    for (const v of mask) count += v;
    expect(count).toBe(1);
    expect(at(mask, level, 2, 1)).toBe(1);
  });

  test("does not mutate the input level", () => {
    const level = levelFrom([".#.", "...", ".+."]);
    const before = Array.from(level.grid.tiles);
    computeFov(level, 0, 1, 8);
    expect(Array.from(level.grid.tiles)).toEqual(before);
  });
});

describe("computeFov — euclidean range", () => {
  test("open field: visible iff dx² + dy² ≤ radius²", () => {
    const rows: string[] = [];
    for (let y = 0; y < 9; y++) rows.push(".".repeat(9));
    const level = levelFrom(rows);
    const radius = 2;
    const mask = computeFov(level, 4, 4, radius);
    for (let y = 0; y < 9; y++) {
      for (let x = 0; x < 9; x++) {
        const inRange = (x - 4) ** 2 + (y - 4) ** 2 <= radius * radius;
        expect(at(mask, level, x, y)).toBe(inRange ? 1 : 0);
      }
    }
  });

  test("walled-in origin: radius 1 lights the 4 cardinal walls, radius 2 all 8 neighbours", () => {
    const level = levelFrom(["###", "#.#", "###"]);
    const r1 = computeFov(level, 1, 1, 1);
    let r1Count = 0;
    for (const v of r1) r1Count += v;
    expect(r1Count).toBe(5);
    expect(at(r1, level, 0, 0)).toBe(0);
    expect(at(r1, level, 1, 0)).toBe(1);
    const r2 = computeFov(level, 1, 1, 2);
    let r2Count = 0;
    for (const v of r2) r2Count += v;
    expect(r2Count).toBe(9);
  });
});

describe("computeFov — occlusion", () => {
  test("a pillar casts a shadow on the column directly behind it", () => {
    const level = levelFrom([
      ".......",
      ".......",
      "...#...",
      ".......",
      ".......",
    ]);
    const mask = computeFov(level, 3, 4, 12);
    // The pillar itself is lit; the two tiles straight behind it are not.
    expect(at(mask, level, 3, 2)).toBe(1);
    expect(at(mask, level, 3, 1)).toBe(0);
    expect(at(mask, level, 3, 0)).toBe(0);
    // Off-axis tiles whose centre-line slips past the pillar stay lit.
    expect(at(mask, level, 2, 1)).toBe(1);
    expect(at(mask, level, 4, 1)).toBe(1);
  });

  test("a closed door blocks sight exactly like a wall", () => {
    const level = levelFrom(["..+.."]);
    const mask = computeFov(level, 0, 0, 12);
    expect(at(mask, level, 1, 0)).toBe(1);
    expect(at(mask, level, 2, 0)).toBe(1); // the door itself is lit
    expect(at(mask, level, 3, 0)).toBe(0);
    expect(at(mask, level, 4, 0)).toBe(0);
  });

  test("a wall segment hides the room behind it but not the wall face", () => {
    const level = levelFrom([".....", "#####", "....."]);
    const mask = computeFov(level, 2, 0, 12);
    // Wall face is lit, the far room is fully dark.
    expect(at(mask, level, 2, 1)).toBe(1);
    for (let x = 0; x < 5; x++) {
      expect(at(mask, level, x, 2)).toBe(0);
    }
  });
});
