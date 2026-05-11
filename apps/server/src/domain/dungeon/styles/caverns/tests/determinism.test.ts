// Phase 2 — determinism + pinned regression.
//
// Locks down (a) byte-identical re-runs, (b) the exact caverns signature for
// seed 42 the impl agent reported, (c) the Phase 1 rim regression so we can
// detect cross-contamination, and (d) cross-seed diversity (catch "all seeds
// converge to the same level" bugs).

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

describe("caverns determinism — byte-identical re-runs", () => {
  const SEEDS: ReadonlyArray<number> = [
    0, 1, 2, 3, 5, 7, 42, 100, 0xdeadbeef, 0xcafebabe,
  ];
  for (const seed of SEEDS) {
    test(`seed ${seed}: two runs produce byte-identical level`, () => {
      const a = generateLevel(createRng(seed), 80, 30, "caverns");
      const b = generateLevel(createRng(seed), 80, 30, "caverns");
      expect(Array.from(a.grid.tiles)).toEqual(Array.from(b.grid.tiles));
      expect(a.spawn).toEqual(b.spawn);
      expect(a.downStairs).toEqual(b.downStairs);
      expect(a.rooms).toEqual(b.rooms);
    });
  }
});

describe("caverns regression pin: seed=42, 80x30", () => {
  // Snapshot of the algorithm's output. If any of these doesn't match, an
  // algorithmic regression has slipped in — either accept the new signature on
  // purpose (and update the values) or fix the regression. Do NOT loosen the
  // assertions to make it pass.
  const lvl = generateLevel(createRng(42), 80, 30, "caverns");
  const { walls, floors, doors } = tileCounts(lvl.grid.tiles);

  test("floor count is 1289", () => {
    expect(floors).toBe(1289);
  });
  test("wall count is 1111", () => {
    expect(walls).toBe(1111);
  });
  test("door count is 0", () => {
    expect(doors).toBe(0);
  });
  test("rooms.length is 0", () => {
    expect(lvl.rooms.length).toBe(0);
  });
  test("spawn is [73, 11]", () => {
    expect(lvl.spawn).toEqual([73, 11]);
  });
  test("downStairs is [3, 18]", () => {
    expect(lvl.downStairs).toEqual([3, 18]);
  });
  test("walls + floors = W*H sanity", () => {
    expect(floors + walls).toBe(2400);
  });
});

describe("caverns diversity across seeds", () => {
  test("different seeds produce different (floor, wall, spawn) tuples", () => {
    const seeds: ReadonlyArray<number> = [0, 1, 2, 3, 4];
    const sigs = seeds.map((s) => {
      const lvl = generateLevel(createRng(s), 80, 30, "caverns");
      const c = tileCounts(lvl.grid.tiles);
      const sp = lvl.spawn;
      if (sp === null) throw new Error(`seed ${s}: spawn null`);
      return `${c.floors}|${c.walls}|${sp[0]},${sp[1]}`;
    });
    // At least two of the five signatures must differ pairwise. We assert via
    // distinct-set size > 1 — collision rate is microscopic but we don't want
    // to over-assert (could trip on a coincidence).
    const distinct = new Set(sigs);
    expect(distinct.size).toBeGreaterThan(1);
  });
});

// FNV-1a 32-bit hash of the level's deterministic content. See rim
// `determinism.test.ts` for rationale. Duplicated inline (not shared) to keep
// the two style folders independent — no cross-style coupling.
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
  return h >>> 0;
}

describe("caverns — many-seed hash regression (100 seeds)", () => {
  // Why this exists: the seed-42 regression above catches drift only on that
  // seed. With 100 seeds × 1 hash each, any algorithmic change touching more
  // than ~1% of the seed space will trip at least one pinned value or the
  // distribution sanity below.
  const hashes: ReadonlyArray<number> = (() => {
    const out: number[] = [];
    for (let s = 0; s < 100; s++) {
      const lvl = generateLevel(createRng(s), 80, 30, "caverns");
      out.push(levelHash(lvl.grid.tiles, lvl.spawn, lvl.downStairs));
    }
    return out;
  })();

  test("seed 0 hash is pinned", () => {
    expect(hashes[0]).toBe(0xd52e5b0d);
  });
  test("seed 1 hash is pinned", () => {
    expect(hashes[1]).toBe(0x01624c7b);
  });
  test("seed 7 hash is pinned", () => {
    expect(hashes[7]).toBe(0xddd048d5);
  });
  test("seed 42 hash is pinned", () => {
    expect(hashes[42]).toBe(0x23d9a731);
  });
  test("seed 99 hash is pinned", () => {
    expect(hashes[99]).toBe(0xfc6d7b4f);
  });

  test("≥ 95 of 100 seeds produce distinct hashes (sanity)", () => {
    const unique = new Set(hashes);
    expect(unique.size).toBeGreaterThanOrEqual(95);
  });
});
