import { describe, expect, test } from "bun:test";
import { createRng } from "../../../../rng/index";
import { emptyLevel } from "../../../index";
import { placeFirstRoom } from "../place-first-room";

describe("placeFirstRoom", () => {
  test("produces exactly one room, with empty doors", () => {
    const pass = placeFirstRoom();
    const out = pass(emptyLevel(40, 20), createRng(1));
    expect(out.rooms.length).toBe(1);
    const r = out.rooms[0];
    if (r === undefined) throw new Error("unreachable");
    expect(r.doors).toEqual([]);
  });

  test("throws if rooms is non-empty (precondition)", () => {
    const pass = placeFirstRoom();
    const base = emptyLevel(40, 20);
    const withRoom = {
      ...base,
      rooms: [{ x: 0, y: 0, w: 1, h: 1, doors: [] }],
    };
    expect(() => pass(withRoom, createRng(0))).toThrow();
  });

  test("throws if the room cannot fit in the grid", () => {
    const pass = placeFirstRoom({ minSize: 9, maxSize: 9 });
    expect(() => pass(emptyLevel(5, 5), createRng(0))).toThrow();
  });

  test("rejects invalid params at construction", () => {
    expect(() => placeFirstRoom({ minSize: 0 })).toThrow();
    expect(() => placeFirstRoom({ minSize: 5, maxSize: 4 })).toThrow();
    expect(() => placeFirstRoom({ minSize: 1.5 })).toThrow();
  });
});
