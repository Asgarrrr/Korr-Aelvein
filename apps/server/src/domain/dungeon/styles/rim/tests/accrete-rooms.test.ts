import { describe, expect, test } from "bun:test";
import { createRng } from "../../../../rng/index";
import { getTile, idx } from "../../../grid";
import { emptyLevel } from "../../../index";
import { TILE_DOOR, TILE_FLOOR, TILE_WALL } from "../../../types";
import { accreteRooms } from "../accrete-rooms";
import { placeFirstRoom } from "../place-first-room";

function seed(s: number, w = 80, h = 30) {
  const rng = createRng(s);
  const after = placeFirstRoom()(emptyLevel(w, h), rng);
  return { level: after, rng };
}

describe("accreteRooms", () => {
  test("adds at least a few rooms on a generous canvas", () => {
    const { level, rng } = seed(1);
    const out = accreteRooms()(level, rng);
    expect(out.rooms.length).toBeGreaterThan(1);
  });

  test("doors are stored on both rooms they connect", () => {
    const { level, rng } = seed(2);
    const out = accreteRooms()(level, rng);
    // Every door on a non-first room must appear on exactly one other room
    // (the host that spawned it). The first room (index 0) may have multiple
    // doors but each must point to a tile that exists somewhere else too.
    for (let i = 1; i < out.rooms.length; i++) {
      const room = out.rooms[i];
      if (room === undefined) throw new Error("unreachable");
      expect(room.doors.length).toBeGreaterThanOrEqual(1);
      for (const [dx, dy] of room.doors) {
        let mirrored = 0;
        for (let j = 0; j < out.rooms.length; j++) {
          if (j === i) continue;
          const other = out.rooms[j];
          if (other === undefined) throw new Error("unreachable");
          for (const [ox, oy] of other.doors) {
            if (ox === dx && oy === dy) mirrored++;
          }
        }
        expect(mirrored).toBeGreaterThanOrEqual(1);
      }
    }
  });

  test("every door coord on a room is actually a TILE_DOOR on the grid", () => {
    const { level, rng } = seed(3);
    const out = accreteRooms()(level, rng);
    for (const r of out.rooms) {
      for (const [dx, dy] of r.doors) {
        expect(getTile(out.grid, dx, dy)).toBe(TILE_DOOR);
      }
    }
  });

  test("every room's floor rectangle is fully TILE_FLOOR", () => {
    const { level, rng } = seed(4);
    const out = accreteRooms()(level, rng);
    for (const r of out.rooms) {
      for (let yy = r.y; yy < r.y + r.h; yy++) {
        for (let xx = r.x; xx < r.x + r.w; xx++) {
          expect(getTile(out.grid, xx, yy)).toBe(TILE_FLOOR);
        }
      }
    }
  });

  test("no two rooms' floor rectangles overlap", () => {
    const { level, rng } = seed(5);
    const out = accreteRooms()(level, rng);
    const occupied = new Set<number>();
    for (const r of out.rooms) {
      for (let yy = r.y; yy < r.y + r.h; yy++) {
        for (let xx = r.x; xx < r.x + r.w; xx++) {
          const i = idx(xx, yy, out.grid.width);
          expect(occupied.has(i)).toBe(false);
          occupied.add(i);
        }
      }
    }
  });

  test("respects maxRooms cap", () => {
    const { level, rng } = seed(6);
    const out = accreteRooms({ maxRooms: 3, maxAttempts: 400 })(level, rng);
    expect(out.rooms.length).toBeLessThanOrEqual(3);
  });

  test("maxAttempts=0 returns the level unchanged in shape", () => {
    const { level, rng } = seed(7);
    const before = level.rooms.length;
    const out = accreteRooms({ maxAttempts: 0 })(level, rng);
    expect(out.rooms.length).toBe(before);
  });

  test("works on an empty rooms array (no host => no-op via early break)", () => {
    const lvl = emptyLevel(40, 20);
    const out = accreteRooms()(lvl, createRng(8));
    expect(out.rooms.length).toBe(0);
    // No mutation expected.
    for (const t of out.grid.tiles) expect(t).toBe(TILE_WALL);
  });

  test("rejects invalid params at construction", () => {
    expect(() => accreteRooms({ maxAttempts: -1 })).toThrow();
    expect(() => accreteRooms({ maxRooms: 0 })).toThrow();
    expect(() => accreteRooms({ minSize: 1 })).toThrow();
    expect(() => accreteRooms({ minSize: 5, maxSize: 4 })).toThrow();
  });
});
