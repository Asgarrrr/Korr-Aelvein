import { describe, expect, test } from "bun:test";
import { createRng } from "../../../../rng/index";
import { emptyLevel, runPipeline } from "../../../index";
import { accreteRooms } from "../accrete-rooms";
import { placeFirstRoom } from "../place-first-room";
import { placeStairs } from "../place-stairs";

describe("placeStairs", () => {
  test("sets downStairs to a room center (not modifying tiles or rooms)", () => {
    const rng = createRng(11);
    const base = runPipeline(emptyLevel(80, 30), rng, [
      placeFirstRoom(),
      accreteRooms(),
    ]);
    const out = placeStairs(base, rng);
    expect(out.downStairs).not.toBeNull();
    if (out.downStairs === null) throw new Error("unreachable");
    const [dx, dy] = out.downStairs;
    // The chosen point matches some room's center.
    const centers = out.rooms.map((r) => [
      r.x + Math.floor(r.w / 2),
      r.y + Math.floor(r.h / 2),
    ]);
    const found = centers.some(([cx, cy]) => cx === dx && cy === dy);
    expect(found).toBe(true);
    // Grid bytes are not modified.
    expect(Array.from(out.grid.tiles)).toEqual(Array.from(base.grid.tiles));
    // Rooms list is unchanged.
    expect(out.rooms).toEqual(base.rooms);
  });

  test("picks the room with the highest squared-Euclidean distance from spawn", () => {
    const rng = createRng(12);
    const base = runPipeline(emptyLevel(80, 30), rng, [
      placeFirstRoom(),
      accreteRooms(),
    ]);
    const out = placeStairs(base, rng);
    if (out.spawn === null || out.downStairs === null) {
      throw new Error("unreachable");
    }
    const [sx, sy] = out.spawn;
    const [dx, dy] = out.downStairs;
    const target = (dx - sx) ** 2 + (dy - sy) ** 2;
    for (const r of out.rooms) {
      const cx = r.x + Math.floor(r.w / 2);
      const cy = r.y + Math.floor(r.h / 2);
      const d2 = (cx - sx) ** 2 + (cy - sy) ** 2;
      expect(d2).toBeLessThanOrEqual(target);
    }
  });

  test("throws if spawn is null (precondition)", () => {
    const rng = createRng(13);
    const lvl = {
      ...emptyLevel(20, 20),
      rooms: [
        { x: 1, y: 1, w: 3, h: 3, doors: [] },
        { x: 10, y: 10, w: 3, h: 3, doors: [] },
      ],
    };
    expect(() => placeStairs(lvl, rng)).toThrow();
  });

  test("throws if rooms.length < 2", () => {
    const rng = createRng(14);
    const base = placeFirstRoom()(emptyLevel(40, 20), rng);
    expect(() => placeStairs(base, rng)).toThrow();
  });
});
