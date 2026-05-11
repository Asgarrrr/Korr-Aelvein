import { describe, expect, test } from "bun:test";
import { createRng } from "../../rng/index";
import {
  emptyLevel,
  type Level,
  type Pass,
  type Room,
  runPipeline,
  TILE_FLOOR,
  TILE_WALL,
} from "../index";

describe("emptyLevel", () => {
  test("80x30 level has the right dimensions and 2400 wall tiles", () => {
    const level = emptyLevel(80, 30);
    expect(level.grid.width).toBe(80);
    expect(level.grid.height).toBe(30);
    expect(level.grid.tiles.length).toBe(2400);
    for (const t of level.grid.tiles) expect(t).toBe(TILE_WALL);
    expect(level.rooms.length).toBe(0);
  });

  test("1x1 level is valid", () => {
    const level = emptyLevel(1, 1);
    expect(level.grid.tiles.length).toBe(1);
    expect(level.grid.tiles[0]).toBe(TILE_WALL);
  });

  test("rejects width 0", () => {
    expect(() => emptyLevel(0, 10)).toThrow();
  });

  test("rejects height 0", () => {
    expect(() => emptyLevel(10, 0)).toThrow();
  });

  test("rejects negative width", () => {
    expect(() => emptyLevel(-5, 10)).toThrow();
  });

  test("rejects negative height", () => {
    expect(() => emptyLevel(10, -5)).toThrow();
  });

  test("rejects NaN dimensions", () => {
    expect(() => emptyLevel(Number.NaN, 10)).toThrow();
    expect(() => emptyLevel(10, Number.NaN)).toThrow();
  });

  test("rejects Infinity dimensions", () => {
    expect(() => emptyLevel(Number.POSITIVE_INFINITY, 10)).toThrow();
    expect(() => emptyLevel(10, Number.POSITIVE_INFINITY)).toThrow();
    expect(() => emptyLevel(Number.NEGATIVE_INFINITY, 10)).toThrow();
  });

  test("rejects float dimensions", () => {
    expect(() => emptyLevel(1.5, 10)).toThrow();
    expect(() => emptyLevel(10, 2.5)).toThrow();
  });

  test("rejects mixed non-finite combinations", () => {
    expect(() => emptyLevel(Number.NaN, Number.POSITIVE_INFINITY)).toThrow();
    expect(() => emptyLevel(0, -1)).toThrow();
  });
});

describe("runPipeline", () => {
  test("empty pipeline returns the same level reference (identity)", () => {
    const level = emptyLevel(10, 10);
    const rng = createRng(0);
    const out = runPipeline(level, rng, []);
    expect(out).toBe(level);
  });

  test("single identityPass returns the same level its pass returned", () => {
    const level = emptyLevel(10, 10);
    const rng = createRng(0);
    const identity: Pass = (l) => l;
    const out = runPipeline(level, rng, [identity]);
    expect(out).toBe(level);
  });

  test("passes are applied in order: passA tags a room, passB asserts the tag", () => {
    const tag: Room = { x: 1, y: 2, w: 3, h: 4, doors: [] };
    const passA: Pass = (l) => ({ ...l, rooms: [...l.rooms, tag] });
    const passB: Pass = (l) => {
      const last = l.rooms[l.rooms.length - 1];
      if (
        last === undefined ||
        last.x !== 1 ||
        last.y !== 2 ||
        last.w !== 3 ||
        last.h !== 4
      ) {
        throw new Error("passB: expected passA's tag room to be present");
      }
      return l;
    };
    const level = emptyLevel(10, 10);
    const rng = createRng(0);
    const out = runPipeline(level, rng, [passA, passB]);
    expect(out.rooms.length).toBe(1);
    expect(out.rooms[0]).toEqual(tag);
  });

  test("reverse ordering ([passB, passA]) throws because the tag is missing", () => {
    const tag: Room = { x: 1, y: 2, w: 3, h: 4, doors: [] };
    const passA: Pass = (l) => ({ ...l, rooms: [...l.rooms, tag] });
    const passB: Pass = (l) => {
      const last = l.rooms[l.rooms.length - 1];
      if (last === undefined) {
        throw new Error("passB: tag missing");
      }
      return l;
    };
    const level = emptyLevel(10, 10);
    const rng = createRng(0);
    expect(() => runPipeline(level, rng, [passB, passA])).toThrow();
  });

  test("each pass receives the previous pass's output", () => {
    const recorded: number[] = [];
    const makeAppender = (n: number): Pass => {
      return (l) => {
        recorded.push(l.rooms.length);
        return {
          ...l,
          rooms: [...l.rooms, { x: n, y: 0, w: 1, h: 1, doors: [] }],
        };
      };
    };
    const level: Level = emptyLevel(5, 5);
    const rng = createRng(0);
    const out = runPipeline(level, rng, [
      makeAppender(0),
      makeAppender(1),
      makeAppender(2),
    ]);
    expect(recorded).toEqual([0, 1, 2]);
    expect(out.rooms.length).toBe(3);
  });

  test("the input level is not mutated by passes that produce new levels", () => {
    const level = emptyLevel(4, 4);
    const rng = createRng(0);
    const fillFloor: Pass = (l) => {
      const tiles = new Uint8Array(l.grid.tiles);
      tiles.fill(TILE_FLOOR);
      return { ...l, grid: { ...l.grid, tiles } };
    };
    const out = runPipeline(level, rng, [fillFloor]);
    expect(out.grid.tiles[0]).toBe(TILE_FLOOR);
    expect(level.grid.tiles[0]).toBe(TILE_WALL);
  });
});
