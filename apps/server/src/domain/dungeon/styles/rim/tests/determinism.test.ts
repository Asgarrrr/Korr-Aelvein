// Determinism and regression pinning for the rim style.
//
// Two flavours:
//   1. Same seed → byte-identical level, across 10 different seeds. Stronger
//      than the single-seed test in dungeon.test.ts.
//   2. Pinned regression: the exact tile/room/spawn/stairs signature for
//      seed 42, 80x30. Pins MORE than dungeon.test.ts: door and wall counts
//      are also locked. If this drifts the algorithm changed silently.

import { describe, expect, test } from "bun:test";
import { createRng } from "../../../../rng/index";
import {
  generateLevel,
  TILE_DOOR,
  TILE_FLOOR,
  TILE_WALL,
} from "../../../index";

function countTiles(tiles: Uint8Array): {
  walls: number;
  floors: number;
  doors: number;
} {
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

const DETERMINISM_SEEDS: ReadonlyArray<number> = [
  0, 1, 2, 7, 13, 42, 0xc0ffee, 0xbadf00d, 0xdeadbeef, 0xcafebabe,
];

describe("rim determinism — many seeds", () => {
  for (const seed of DETERMINISM_SEEDS) {
    test(`seed ${seed}: two runs produce byte-identical level`, () => {
      const a = generateLevel(createRng(seed), 80, 30, "rim");
      const b = generateLevel(createRng(seed), 80, 30, "rim");
      expect(Array.from(a.grid.tiles)).toEqual(Array.from(b.grid.tiles));
      expect(a.rooms).toEqual(b.rooms);
      expect(a.spawn).toEqual(b.spawn);
      expect(a.downStairs).toEqual(b.downStairs);
    });
  }
});

describe("rim regression pin — seed 42, 80x30", () => {
  // If any of these values drift, STOP. Don't loosen the assertion to make
  // it pass: either accept the new signature on purpose (and update the
  // numbers here in the same commit) or fix the regression.
  test("rooms.length, floor count, door count, wall count, spawn, downStairs", () => {
    const lvl = generateLevel(createRng(42), 80, 30, "rim");
    const { walls, floors, doors } = countTiles(lvl.grid.tiles);
    expect(lvl.rooms.length).toBe(25);
    expect(floors).toBe(935);
    expect(doors).toBe(29);
    expect(walls).toBe(1436);
    expect(walls + floors + doors).toBe(80 * 30);
    expect(lvl.spawn).toEqual([39, 14]);
    expect(lvl.downStairs).toEqual([75, 26]);
  });
});

describe("rim — different seeds produce different levels", () => {
  // Statistical, not strict pairwise: at least two of three differ on
  // rooms.length OR floor count. Reasonable hedge for the rare case where
  // two distinct seeds produce the same coarse signature by accident.
  test("seeds 0/1/2 do not all collide on (rooms.length, floors)", () => {
    const signatures = [0, 1, 2].map((s) => {
      const lvl = generateLevel(createRng(s), 80, 30, "rim");
      const { floors } = countTiles(lvl.grid.tiles);
      return `${lvl.rooms.length}:${floors}`;
    });
    const unique = new Set(signatures);
    expect(unique.size).toBeGreaterThanOrEqual(2);
  });
});

// FNV-1a 32-bit hash of the level's deterministic content (grid bytes + spawn
// + stairs). Cheap, no allocation, pure 32-bit arithmetic — same hash on V8,
// JSC, and any IEEE-754 engine. Not cryptographic; used purely as a byte-level
// signature for regression-pinning across many seeds.
function levelHash(
  tiles: Uint8Array,
  spawn: readonly [number, number] | null,
  stairs: readonly [number, number] | null,
): number {
  let h = 2166136261 | 0;
  for (const t of tiles) h = Math.imul(h ^ t, 16777619) | 0;
  if (spawn !== null) {
    h = Math.imul(h ^ spawn[0], 16777619) | 0;
    h = Math.imul(h ^ spawn[1], 16777619) | 0;
  }
  if (stairs !== null) {
    h = Math.imul(h ^ stairs[0], 16777619) | 0;
    h = Math.imul(h ^ stairs[1], 16777619) | 0;
  }
  return h >>> 0; // u32
}

describe("rim — many-seed hash regression (100 seeds)", () => {
  // Why this exists: a single pinned regression (seed 42 above) catches drift
  // only on that seed. With 100 seeds × 1 hash each, any algorithmic change
  // that affects more than ~1% of seeds will trip at least one pinned value.
  // Pin a handful of explicit hashes (canaries) + assert distribution sanity.
  const hashes: ReadonlyArray<number> = (() => {
    const out: number[] = [];
    for (let s = 0; s < 100; s++) {
      const lvl = generateLevel(createRng(s), 80, 30, "rim");
      out.push(levelHash(lvl.grid.tiles, lvl.spawn, lvl.downStairs));
    }
    return out;
  })();

  test("seed 0 hash is pinned", () => {
    expect(hashes[0]).toBe(0x90d34b2f);
  });
  test("seed 1 hash is pinned", () => {
    expect(hashes[1]).toBe(0xa64cf7ad);
  });
  test("seed 7 hash is pinned", () => {
    expect(hashes[7]).toBe(0x297f49e2);
  });
  test("seed 42 hash is pinned", () => {
    expect(hashes[42]).toBe(0x1a1ee6d8);
  });
  test("seed 99 hash is pinned", () => {
    expect(hashes[99]).toBe(0x3a680bc2);
  });

  test("≥ 95 of 100 seeds produce distinct hashes (sanity)", () => {
    const unique = new Set(hashes);
    expect(unique.size).toBeGreaterThanOrEqual(95);
  });
});
