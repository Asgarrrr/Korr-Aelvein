import { describe, expect, test } from "bun:test";
import { createRng } from "../../../../rng/index";
import { emptyLevel } from "../../../index";
import { iterateCA } from "../iterate-ca";
import { seedCA } from "../seed-ca";

describe("iterateCA", () => {
  test("does not consume rng (deterministic CA)", () => {
    const seeded = seedCA({ wallProbability: 0.45 })(
      emptyLevel(20, 12),
      createRng(3),
    );
    const rng = createRng(123);
    const probe1 = rng.next();
    const out = iterateCA()(seeded, rng);
    // Ignore output, but verify rng was untouched: next() should yield the
    // same sequence as a fresh rng(123) after one .next() advance.
    const ref = createRng(123);
    ref.next();
    expect(rng.next()).toBe(ref.next());
    expect(probe1).toBeDefined();
    expect(out.grid.tiles.length).toBe(seeded.grid.tiles.length);
  });

  test("does not mutate the input level tiles", () => {
    const seeded = seedCA({ wallProbability: 0.45 })(
      emptyLevel(20, 12),
      createRng(8),
    );
    const before = new Uint8Array(seeded.grid.tiles);
    iterateCA()(seeded, createRng(0));
    for (let i = 0; i < before.length; i++) {
      expect(seeded.grid.tiles[i]).toBe(before[i] ?? -1);
    }
  });

  test("preserves rooms / spawn / downStairs", () => {
    const seeded = seedCA({ wallProbability: 0.45 })(
      emptyLevel(20, 12),
      createRng(9),
    );
    const out = iterateCA()(seeded, createRng(0));
    expect(out.rooms).toEqual([]);
    expect(out.spawn).toBeNull();
    expect(out.downStairs).toBeNull();
  });

  test("rejects invalid params at construction", () => {
    expect(() => iterateCA({ iterations: -1 })).toThrow();
    expect(() => iterateCA({ iterations: 1.5 })).toThrow();
    expect(() => iterateCA({ birthLimit: -1 })).toThrow();
    expect(() => iterateCA({ birthLimit: 9 })).toThrow();
    expect(() => iterateCA({ birthLimit: 4.5 })).toThrow();
    expect(() => iterateCA({ survivalLimit: -1 })).toThrow();
    expect(() => iterateCA({ survivalLimit: 9 })).toThrow();
  });
});
