import { describe, expect, test } from "bun:test";
import { createRng } from "../../../../rng/index";
import { emptyLevel } from "../../../index";
import { seedCA } from "../seed-ca";

describe("seedCA", () => {
  test("does not touch rooms / spawn / downStairs", () => {
    const out = seedCA()(emptyLevel(20, 10), createRng(5));
    expect(out.rooms).toEqual([]);
    expect(out.spawn).toBeNull();
    expect(out.downStairs).toBeNull();
  });

  test("determinism: same seed → identical tiles", () => {
    const a = seedCA()(emptyLevel(40, 20), createRng(6));
    const b = seedCA()(emptyLevel(40, 20), createRng(6));
    expect(Array.from(a.grid.tiles)).toEqual(Array.from(b.grid.tiles));
  });

  test("consumes exactly W*H rng draws (advances chance count predictably)", () => {
    // Run seedCA, then a single rng call; the same single rng call from a fresh
    // rng pre-advanced by W*H chance() calls must match.
    const rngA = createRng(7);
    seedCA({ wallProbability: 0.45 })(emptyLevel(10, 8), rngA);
    const afterSeedFloat = rngA.next();

    const rngB = createRng(7);
    for (let i = 0; i < 10 * 8; i++) rngB.chance(0.45);
    const manualFloat = rngB.next();

    expect(afterSeedFloat).toBe(manualFloat);
  });

  test("does not mutate the input level", () => {
    const base = emptyLevel(20, 15);
    const before = new Uint8Array(base.grid.tiles);
    seedCA()(base, createRng(8));
    for (let i = 0; i < before.length; i++) {
      expect(base.grid.tiles[i]).toBe(before[i] ?? -1);
    }
  });

  test("rejects invalid params at construction", () => {
    expect(() => seedCA({ wallProbability: -0.01 })).toThrow();
    expect(() => seedCA({ wallProbability: 1.01 })).toThrow();
    expect(() => seedCA({ wallProbability: Number.NaN })).toThrow();
    expect(() =>
      seedCA({ wallProbability: Number.POSITIVE_INFINITY }),
    ).toThrow();
  });
});
