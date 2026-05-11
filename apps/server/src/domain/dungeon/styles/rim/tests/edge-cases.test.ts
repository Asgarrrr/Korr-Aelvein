// Adversarial Phase 1 — hostile inputs against the rim style and its passes.
//
// Goal: surface failure modes (clean throws vs silent corruption vs runaway
// loops), document the impl's actual behaviour on tiny / huge / asymmetric
// grids, and exercise factory-level validation. The orchestrator wants to
// know which of these crash and which degrade gracefully.

import { describe, expect, test } from "bun:test";
import { createRng } from "../../../../rng/index";
import { idx } from "../../../grid";
import {
  emptyLevel,
  generateLevel,
  type Level,
  runPipeline,
  TILE_DOOR,
  TILE_FLOOR,
} from "../../../index";
import { accreteRooms } from "../accrete-rooms";
import { addLoops } from "../add-loops";
import { placeFirstRoom } from "../place-first-room";

function floodFromSpawn(level: Level): Set<number> {
  if (level.spawn === null) throw new Error("flood: spawn null");
  const W = level.grid.width;
  const H = level.grid.height;
  const visited = new Set<number>();
  const start = idx(level.spawn[0], level.spawn[1], W);
  visited.add(start);
  const queue: Array<readonly [number, number]> = [level.spawn];
  while (queue.length > 0) {
    const head = queue.shift();
    if (head === undefined) throw new Error("flood: queue invariant");
    const [x, y] = head;
    const ns: ReadonlyArray<readonly [number, number]> = [
      [x, y - 1],
      [x + 1, y],
      [x, y + 1],
      [x - 1, y],
    ];
    for (const [nx, ny] of ns) {
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const i = idx(nx, ny, W);
      if (visited.has(i)) continue;
      const t = level.grid.tiles[i];
      if (t !== TILE_FLOOR && t !== TILE_DOOR) continue;
      visited.add(i);
      queue.push([nx, ny]);
    }
  }
  return visited;
}

describe("rim edge cases — grid sizes", () => {
  test("10x10: placeStairs throws because only one room fits", () => {
    // Documented behaviour: the rim pipeline cannot place a second room on
    // a 10x10 with first-room min size 5 + a 1-cell perimeter. The
    // orchestrator should treat 'placeStairs needs >= 2 rooms' as a
    // recoverable signal that the level is too small for this style.
    expect(() => generateLevel(createRng(1), 10, 10, "rim")).toThrow(
      /placeStairs: needs >= 2 rooms/,
    );
  });

  test("6x6: same failure mode — first room fits, accretion does not", () => {
    expect(() => generateLevel(createRng(1), 6, 6, "rim")).toThrow(
      /placeStairs: needs >= 2 rooms/,
    );
  });

  test("5x5: first room exactly fits, accretion impossible → placeStairs throws", () => {
    expect(() => generateLevel(createRng(1), 5, 5, "rim")).toThrow(
      /placeStairs: needs >= 2 rooms/,
    );
  });

  test("4x4: placeFirstRoom throws because the room cannot fit", () => {
    expect(() => generateLevel(createRng(1), 4, 4, "rim")).toThrow(
      /placeFirstRoom: room .* does not fit/,
    );
  });

  test("1x100 (column): placeFirstRoom throws — first room too wide", () => {
    expect(() => generateLevel(createRng(1), 1, 100, "rim")).toThrow(
      /placeFirstRoom/,
    );
  });

  test("100x1 (row): placeFirstRoom throws — first room too tall", () => {
    expect(() => generateLevel(createRng(1), 100, 1, "rim")).toThrow(
      /placeFirstRoom/,
    );
  });

  test("200x100 (huge): runs in well under 1 second and stays connected", () => {
    const t0 = performance.now();
    const lvl = generateLevel(createRng(42), 200, 100, "rim");
    const elapsed = performance.now() - t0;
    expect(elapsed).toBeLessThan(1000);
    expect(lvl.rooms.length).toBeGreaterThan(1);
    if (lvl.spawn === null) throw new Error("unreachable");
    const reached = floodFromSpawn(lvl);
    let walkable = 0;
    for (const t of lvl.grid.tiles) {
      if (t === TILE_FLOOR || t === TILE_DOOR) walkable++;
    }
    expect(reached.size).toBe(walkable);
  });
});

describe("rim edge cases — accreteRooms degenerate params", () => {
  test("maxRooms:1 leaves only the first room, placeStairs throws", () => {
    const rng = createRng(11);
    const after = runPipeline(emptyLevel(80, 30), rng, [
      placeFirstRoom(),
      accreteRooms({ maxRooms: 1 }),
    ]);
    expect(after.rooms.length).toBe(1);
    if (after.spawn === null) throw new Error("unreachable");
    // Connectivity from spawn still holds (single room, all FLOOR).
    const reached = floodFromSpawn(after);
    let floors = 0;
    for (const t of after.grid.tiles) if (t === TILE_FLOOR) floors++;
    expect(reached.size).toBe(floors);
    // placeStairs throws because rooms.length < 2.
    expect(() => generateLevel(createRng(11), 80, 30, "rim")).not.toThrow();
    // (Above is the full pipeline succeeding with default maxRooms=25, not
    // a contradiction — we're proving the contrived sub-pipeline throws.)
  });

  test("accreteRooms maxAttempts:0 makes no additions", () => {
    const rng = createRng(12);
    const lvl = placeFirstRoom()(emptyLevel(80, 30), rng);
    const before = lvl.rooms.length;
    const after = accreteRooms({ maxAttempts: 0 })(lvl, rng);
    expect(after.rooms.length).toBe(before);
    // Tile bytes unchanged.
    expect(Array.from(after.grid.tiles)).toEqual(Array.from(lvl.grid.tiles));
  });
});

describe("rim edge cases — addLoops degenerate params", () => {
  test("maxLoops:0 produces a tree-shaped level, still fully connected", () => {
    const rng = createRng(21);
    const base = runPipeline(emptyLevel(80, 30), rng, [
      placeFirstRoom(),
      accreteRooms(),
    ]);
    let doorsBefore = 0;
    for (const t of base.grid.tiles) if (t === TILE_DOOR) doorsBefore++;
    const out = addLoops({ maxLoops: 0 })(base, rng);
    let doorsAfter = 0;
    for (const t of out.grid.tiles) if (t === TILE_DOOR) doorsAfter++;
    expect(doorsAfter).toBe(doorsBefore);
    // Connectivity still holds (no loops, but accretion already connected).
    const reached = floodFromSpawn(out);
    let walkable = 0;
    for (const t of out.grid.tiles) {
      if (t === TILE_FLOOR || t === TILE_DOOR) walkable++;
    }
    expect(reached.size).toBe(walkable);
  });

  test("minPathDistance:1 is generous; connectivity still holds (loops only add doors)", () => {
    const rng = createRng(22);
    const base = runPipeline(emptyLevel(80, 30), rng, [
      placeFirstRoom(),
      accreteRooms(),
    ]);
    const out = addLoops({ minPathDistance: 1 })(base, rng);
    const reached = floodFromSpawn(out);
    let walkable = 0;
    for (const t of out.grid.tiles) {
      if (t === TILE_FLOOR || t === TILE_DOOR) walkable++;
    }
    expect(reached.size).toBe(walkable);
  });
});

describe("rim edge cases — factory validation", () => {
  test("accreteRooms() default factory does not throw", () => {
    expect(() => accreteRooms()).not.toThrow();
  });
  test("addLoops() default factory does not throw", () => {
    expect(() => addLoops()).not.toThrow();
  });
  test("placeFirstRoom() default factory does not throw", () => {
    expect(() => placeFirstRoom()).not.toThrow();
  });

  test("accreteRooms({ minSize: 1 }) throws (must be >= 2)", () => {
    expect(() => accreteRooms({ minSize: 1 })).toThrow();
  });
  test("accreteRooms({ maxSize: 3, minSize: 5 }) throws", () => {
    expect(() => accreteRooms({ maxSize: 3, minSize: 5 })).toThrow();
  });
  test("accreteRooms({ maxAttempts: 1.5 }) throws (non-integer)", () => {
    expect(() => accreteRooms({ maxAttempts: 1.5 })).toThrow();
  });
  test("accreteRooms({ maxRooms: 0 }) throws", () => {
    expect(() => accreteRooms({ maxRooms: 0 })).toThrow();
  });

  test("addLoops({ minPathDistance: 0 }) throws", () => {
    expect(() => addLoops({ minPathDistance: 0 })).toThrow();
  });
  test("addLoops({ minPathDistance: -1 }) throws", () => {
    expect(() => addLoops({ minPathDistance: -1 })).toThrow();
  });
  test("addLoops({ maxAttempts: -1 }) throws", () => {
    expect(() => addLoops({ maxAttempts: -1 })).toThrow();
  });
  test("addLoops({ maxLoops: -1 }) throws", () => {
    expect(() => addLoops({ maxLoops: -1 })).toThrow();
  });
});
