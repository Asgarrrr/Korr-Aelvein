import { describe, expect, test } from "bun:test";
import { createRng } from "../../../../rng/index";
import { getTile, idx } from "../../../grid";
import { emptyLevel, runPipeline } from "../../../index";
import { TILE_DOOR, TILE_FLOOR, TILE_WALL } from "../../../types";
import { accreteRooms } from "../accrete-rooms";
import { addLoops } from "../add-loops";
import { placeFirstRoom } from "../place-first-room";

function buildBase(seed: number) {
  const rng = createRng(seed);
  const lvl = runPipeline(emptyLevel(80, 30), rng, [
    placeFirstRoom(),
    accreteRooms(),
  ]);
  return { lvl, rng };
}

function countDoors(grid: { tiles: Uint8Array }): number {
  let c = 0;
  for (const t of grid.tiles) if (t === TILE_DOOR) c++;
  return c;
}

describe("addLoops", () => {
  test("adds at least one loop on a typical floor", () => {
    const { lvl, rng } = buildBase(101);
    const before = countDoors(lvl.grid);
    const out = addLoops()(lvl, rng);
    const after = countDoors(out.grid);
    expect(after).toBeGreaterThan(before);
  });

  test("respects maxLoops cap", () => {
    const { lvl, rng } = buildBase(102);
    const before = countDoors(lvl.grid);
    const out = addLoops({ maxLoops: 2, maxAttempts: 400 })(lvl, rng);
    const after = countDoors(out.grid);
    expect(after - before).toBeLessThanOrEqual(2);
  });

  test("maxLoops=0 leaves doors count unchanged", () => {
    const { lvl, rng } = buildBase(103);
    const before = countDoors(lvl.grid);
    const out = addLoops({ maxLoops: 0 })(lvl, rng);
    expect(countDoors(out.grid)).toBe(before);
  });

  test("does not change existing floors or doors — only wall→door promotions", () => {
    const { lvl, rng } = buildBase(104);
    const out = addLoops()(lvl, rng);
    for (let y = 0; y < lvl.grid.height; y++) {
      for (let x = 0; x < lvl.grid.width; x++) {
        const before = getTile(lvl.grid, x, y);
        const after = getTile(out.grid, x, y);
        if (before === TILE_FLOOR) expect(after).toBe(TILE_FLOOR);
        if (before === TILE_DOOR) expect(after).toBe(TILE_DOOR);
        if (after !== before) {
          expect(before).toBe(TILE_WALL);
          expect(after).toBe(TILE_DOOR);
        }
      }
    }
  });

  test("does NOT update level.rooms door lists (loops are standalone tiles)", () => {
    const { lvl, rng } = buildBase(105);
    const beforeDoors = lvl.rooms.map((r) => r.doors.length);
    const out = addLoops()(lvl, rng);
    const afterDoors = out.rooms.map((r) => r.doors.length);
    expect(afterDoors).toEqual(beforeDoors);
  });

  test("a high minPathDistance prunes most loops", () => {
    const { lvl, rng } = buildBase(106);
    const before = countDoors(lvl.grid);
    const out = addLoops({ minPathDistance: 1000 })(lvl, rng);
    expect(countDoors(out.grid)).toBe(before);
  });

  test("rejects invalid params at construction", () => {
    expect(() => addLoops({ maxAttempts: -1 })).toThrow();
    expect(() => addLoops({ maxLoops: -1 })).toThrow();
    expect(() => addLoops({ minPathDistance: 0 })).toThrow();
    expect(() => addLoops({ minPathDistance: 1.5 })).toThrow();
  });

  test("on an all-wall level (no floor anywhere) does not add doors", () => {
    const lvl = emptyLevel(20, 20);
    const out = addLoops()(lvl, createRng(108));
    for (const t of out.grid.tiles) expect(t).toBe(TILE_WALL);
  });

  test("every added door has floor (or door) on exactly two opposite sides", () => {
    const { lvl, rng } = buildBase(109);
    const out = addLoops()(lvl, rng);
    // Tiles that became doors but were walls before.
    for (let y = 0; y < lvl.grid.height; y++) {
      for (let x = 0; x < lvl.grid.width; x++) {
        const wasWall = lvl.grid.tiles[idx(x, y, lvl.grid.width)] === TILE_WALL;
        const isDoor = out.grid.tiles[idx(x, y, out.grid.width)] === TILE_DOOR;
        if (!wasWall || !isDoor) continue;
        const isWalk = (xx: number, yy: number) => {
          if (xx < 0 || yy < 0 || xx >= out.grid.width || yy >= out.grid.height)
            return false;
          const t = out.grid.tiles[idx(xx, yy, out.grid.width)];
          return t === TILE_FLOOR || t === TILE_DOOR;
        };
        const n = isWalk(x, y - 1);
        const s = isWalk(x, y + 1);
        const e = isWalk(x + 1, y);
        const w = isWalk(x - 1, y);
        const ns = n && s && !e && !w;
        const ew = e && w && !n && !s;
        expect(ns || ew).toBe(true);
      }
    }
  });
});
