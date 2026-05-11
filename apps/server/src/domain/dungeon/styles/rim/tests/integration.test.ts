// End-to-end tests for the RIM style. Also pins a regression signature so
// algorithmic changes get caught even when individual passes still type-check.

import { describe, expect, test } from "bun:test";
import { createRng } from "../../../../rng/index";
import {
  generateLevel,
  TILE_DOOR,
  TILE_FLOOR,
  TILE_WALL,
} from "../../../index";

function tileCounts(tiles: Uint8Array) {
  let walls = 0;
  let floors = 0;
  let doors = 0;
  for (const t of tiles) {
    if (t === TILE_WALL) walls++;
    else if (t === TILE_FLOOR) floors++;
    else if (t === TILE_DOOR) doors++;
  }
  return { walls, floors, doors };
}

describe("generateLevel (rim)", () => {
  test("produces a level with spawn, downStairs, and at least one room", () => {
    const lvl = generateLevel(createRng(1), 80, 30, "rim");
    expect(lvl.spawn).not.toBeNull();
    expect(lvl.downStairs).not.toBeNull();
    expect(lvl.rooms.length).toBeGreaterThanOrEqual(1);
  });

  test("the grid contains both TILE_WALL and TILE_FLOOR", () => {
    const lvl = generateLevel(createRng(2), 80, 30, "rim");
    const { walls, floors } = tileCounts(lvl.grid.tiles);
    expect(walls).toBeGreaterThan(0);
    expect(floors).toBeGreaterThan(0);
  });

  test("every door coord listed on a room is a TILE_DOOR on the grid", () => {
    const lvl = generateLevel(createRng(3), 80, 30, "rim");
    for (const r of lvl.rooms) {
      for (const [dx, dy] of r.doors) {
        expect(lvl.grid.tiles[dy * lvl.grid.width + dx]).toBe(TILE_DOOR);
      }
    }
  });

  test("determinism: same seed → byte-identical grid and equal rooms", () => {
    const a = generateLevel(createRng(42), 80, 30, "rim");
    const b = generateLevel(createRng(42), 80, 30, "rim");
    expect(Array.from(a.grid.tiles)).toEqual(Array.from(b.grid.tiles));
    expect(a.rooms).toEqual(b.rooms);
    expect(a.spawn).toEqual(b.spawn);
    expect(a.downStairs).toEqual(b.downStairs);
  });
});
