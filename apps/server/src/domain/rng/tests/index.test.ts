import { describe, expect, test } from "bun:test";
import { createRng, fromRngState } from "../index";

describe("createRng — basics", () => {
  test("same seed produces the same sequence", () => {
    const a = createRng(42);
    const b = createRng(42);
    const seqA = Array.from({ length: 10 }, () => a.next());
    const seqB = Array.from({ length: 10 }, () => b.next());
    expect(seqA).toEqual(seqB);
  });

  test("different seeds produce different sequences", () => {
    const a = createRng(1);
    const b = createRng(2);
    expect(a.next()).not.toBe(b.next());
  });

  test("next() stays in [0, 1)", () => {
    const rng = createRng(7);
    for (let i = 0; i < 1000; i++) {
      const v = rng.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  test("int(min, max) is inclusive on both bounds", () => {
    const rng = createRng(123);
    const seen = new Set<number>();
    for (let i = 0; i < 1000; i++) seen.add(rng.int(1, 6));
    expect(seen.has(1)).toBe(true);
    expect(seen.has(6)).toBe(true);
    for (const v of seen) {
      expect(v).toBeGreaterThanOrEqual(1);
      expect(v).toBeLessThanOrEqual(6);
    }
  });

  test("int(n, n) always returns n", () => {
    const rng = createRng(999);
    for (let i = 0; i < 50; i++) expect(rng.int(5, 5)).toBe(5);
  });

  test("int rejects max < min", () => {
    const rng = createRng(0);
    expect(() => rng.int(5, 3)).toThrow();
  });

  test("pick returns elements from the input array", () => {
    const rng = createRng(2024);
    const arr = ["a", "b", "c", "d"];
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) seen.add(rng.pick(arr));
    expect(seen.size).toBe(arr.length);
  });

  test("pick on empty array throws", () => {
    const rng = createRng(0);
    expect(() => rng.pick([])).toThrow();
  });

  test("chance(0) is always false, chance(1) is always true", () => {
    const rng = createRng(17);
    for (let i = 0; i < 100; i++) {
      expect(rng.chance(0)).toBe(false);
      expect(rng.chance(1)).toBe(true);
    }
  });
});

describe("createRng — seed normalisation", () => {
  test("NaN seed is equivalent to seed 0", () => {
    const a = createRng(Number.NaN);
    const b = createRng(0);
    expect(a.next()).toBe(b.next());
  });

  test("Infinity seed is equivalent to seed 0", () => {
    const a = createRng(Number.POSITIVE_INFINITY);
    const b = createRng(0);
    expect(a.next()).toBe(b.next());
  });

  test("-Infinity seed is equivalent to seed 0", () => {
    const a = createRng(Number.NEGATIVE_INFINITY);
    const b = createRng(0);
    expect(a.next()).toBe(b.next());
  });

  test("2^32 seed wraps to 0", () => {
    const a = createRng(2 ** 32);
    const b = createRng(0);
    expect(a.next()).toBe(b.next());
  });

  test("negative seed produces a deterministic sequence", () => {
    const a = createRng(-1);
    const b = createRng(-1);
    const seqA = Array.from({ length: 10 }, () => a.next());
    const seqB = Array.from({ length: 10 }, () => b.next());
    expect(seqA).toEqual(seqB);
    expect(seqA[0]).not.toBe(0);
  });

  test("float seed truncates toward 0", () => {
    const a = createRng(1.7);
    const b = createRng(1);
    expect(a.next()).toBe(b.next());
  });

  test("MAX_SAFE_INTEGER seed produces a valid sequence", () => {
    const rng = createRng(Number.MAX_SAFE_INTEGER);
    const v = rng.next();
    expect(v).toBeGreaterThanOrEqual(0);
    expect(v).toBeLessThan(1);
  });
});

describe("createRng — independence", () => {
  test("two RNGs from the same seed do not share state", () => {
    const a = createRng(42);
    const b = createRng(42);
    a.next();
    a.next();
    a.next();
    // b should still be at the start.
    const fromB = b.next();
    const freshFromA = createRng(42).next();
    expect(fromB).toBe(freshFromA);
  });

  test("two RNGs with different seeds yield different long sequences", () => {
    const a = createRng(1);
    const b = createRng(2);
    const seqA = Array.from({ length: 100 }, () => a.next());
    const seqB = Array.from({ length: 100 }, () => b.next());
    // Allow rare collisions; expect overwhelming majority to differ.
    let differing = 0;
    for (let i = 0; i < 100; i++) {
      if (seqA[i] !== seqB[i]) differing++;
    }
    expect(differing).toBeGreaterThan(95);
  });
});

describe("createRng — long-running determinism", () => {
  test("10000 calls with the same seed produce the same sequence", () => {
    const a = createRng(0xc0ffee);
    const b = createRng(0xc0ffee);
    for (let i = 0; i < 10_000; i++) {
      expect(a.next()).toBe(b.next());
    }
  });
});

describe("createRng — int edge cases", () => {
  test("handles fully negative ranges", () => {
    const rng = createRng(11);
    for (let i = 0; i < 200; i++) {
      const v = rng.int(-10, -5);
      expect(v).toBeGreaterThanOrEqual(-10);
      expect(v).toBeLessThanOrEqual(-5);
    }
  });

  test("handles ranges crossing zero", () => {
    const rng = createRng(13);
    const seen = new Set<number>();
    for (let i = 0; i < 1000; i++) seen.add(rng.int(-3, 3));
    expect(seen).toEqual(new Set([-3, -2, -1, 0, 1, 2, 3]));
  });

  test("over many iterations, every integer in the range is reachable", () => {
    const rng = createRng(7);
    const seen = new Set<number>();
    for (let i = 0; i < 5000; i++) seen.add(rng.int(0, 9));
    expect(seen).toEqual(new Set([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]));
  });

  test("rejects non-integer min", () => {
    const rng = createRng(0);
    expect(() => rng.int(1.5, 5)).toThrow();
  });

  test("rejects non-integer max", () => {
    const rng = createRng(0);
    expect(() => rng.int(1, 5.5)).toThrow();
  });

  test("rejects NaN bounds", () => {
    const rng = createRng(0);
    expect(() => rng.int(Number.NaN, 5)).toThrow();
    expect(() => rng.int(0, Number.NaN)).toThrow();
  });

  test("rejects Infinity bounds", () => {
    const rng = createRng(0);
    expect(() => rng.int(Number.POSITIVE_INFINITY, 5)).toThrow();
    expect(() => rng.int(0, Number.POSITIVE_INFINITY)).toThrow();
    expect(() => rng.int(Number.NEGATIVE_INFINITY, 5)).toThrow();
  });
});

describe("createRng — pick edge cases", () => {
  test("pick from a single-element array returns that element", () => {
    const rng = createRng(0);
    const only = "only";
    for (let i = 0; i < 50; i++) expect(rng.pick([only])).toBe(only);
  });

  test("pick returns indexes strictly within bounds", () => {
    const rng = createRng(0);
    const arr = [0, 1, 2, 3, 4];
    for (let i = 0; i < 5000; i++) {
      const v = rng.pick(arr);
      expect(arr).toContain(v);
    }
  });

  test("pick handles arrays whose elements include `undefined`", () => {
    const rng = createRng(0);
    const arr: ReadonlyArray<number | undefined> = [1, undefined, 3];
    let undefinedCount = 0;
    for (let i = 0; i < 500; i++) {
      const v = rng.pick(arr);
      if (v === undefined) undefinedCount++;
    }
    expect(undefinedCount).toBeGreaterThan(0);
  });
});

describe("createRng — chance edge cases", () => {
  test("chance(0.5) is roughly balanced over 10000 calls", () => {
    const rng = createRng(2024);
    let truthy = 0;
    for (let i = 0; i < 10_000; i++) if (rng.chance(0.5)) truthy++;
    expect(truthy).toBeGreaterThan(4500);
    expect(truthy).toBeLessThan(5500);
  });

  test("rejects NaN", () => {
    const rng = createRng(0);
    expect(() => rng.chance(Number.NaN)).toThrow();
  });

  test("rejects negative probabilities", () => {
    const rng = createRng(0);
    expect(() => rng.chance(-0.1)).toThrow();
    expect(() => rng.chance(-1)).toThrow();
  });

  test("rejects probabilities greater than 1", () => {
    const rng = createRng(0);
    expect(() => rng.chance(1.1)).toThrow();
    expect(() => rng.chance(2)).toThrow();
  });

  test("rejects Infinity", () => {
    const rng = createRng(0);
    expect(() => rng.chance(Number.POSITIVE_INFINITY)).toThrow();
    expect(() => rng.chance(Number.NEGATIVE_INFINITY)).toThrow();
  });
});

describe("createRng — state save/restore", () => {
  test("state() returns a tuple of four 32-bit signed integers", () => {
    const rng = createRng(42);
    const s = rng.state();
    expect(s.length).toBe(4);
    for (const v of s) {
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(-(2 ** 31));
      expect(v).toBeLessThan(2 ** 31);
    }
  });

  test("calling state() twice without an intervening next() returns the same tuple", () => {
    const rng = createRng(42);
    rng.next();
    rng.next();
    expect(rng.state()).toEqual(rng.state());
  });

  test("state advances after each call to next()", () => {
    const rng = createRng(42);
    const s1 = rng.state();
    rng.next();
    const s2 = rng.state();
    expect(s2).not.toEqual(s1);
  });

  test("fromRngState resumes the exact same sequence", () => {
    const a = createRng(2024);
    a.next();
    a.next();
    a.next();
    const checkpoint = a.state();
    const b = fromRngState(checkpoint);

    const tailA = Array.from({ length: 100 }, () => a.next());
    const tailB = Array.from({ length: 100 }, () => b.next());
    expect(tailA).toEqual(tailB);
  });

  test("snapshot is decoupled from the live Rng (mutating later does not affect the snapshot)", () => {
    const rng = createRng(7);
    const before = rng.state();
    for (let i = 0; i < 1000; i++) rng.next();
    const after = rng.state();
    // If `before` were a live view, it would now equal `after`.
    expect(before).not.toEqual(after);
  });

  test("fromRngState + state() round-trip is the identity for many states", () => {
    const rng = createRng(0xfeedface);
    for (let i = 0; i < 100; i++) {
      const s = rng.state();
      const restored = fromRngState(s);
      expect(restored.state()).toEqual(s);
      rng.next();
    }
  });
});

describe("createRng — algorithm regression (sfc32 + SplitMix32)", () => {
  test("seed 42 produces a stable, pinned sequence", () => {
    // Anti-regression guard: changing the PRNG implementation will fail this.
    // Update only if the algorithm change is intentional.
    const rng = createRng(42);
    const sequence = Array.from({ length: 5 }, () => rng.next());
    expect(sequence).toEqual([
      0.8686135609168559, 0.41595513583160937, 0.33768315333873034,
      0.5103033822961152, 0.8812672768253833,
    ]);
  });
});

describe("createRng — split()", () => {
  test("split is deterministic given the same parent state", () => {
    const a = createRng(42);
    const b = createRng(42);
    const childA = a.split();
    const childB = b.split();
    const seqA = Array.from({ length: 20 }, () => childA.next());
    const seqB = Array.from({ length: 20 }, () => childB.next());
    expect(seqA).toEqual(seqB);
  });

  test("split advances the parent (parent diverges from a non-split twin)", () => {
    const a = createRng(42);
    const b = createRng(42);
    a.split();
    expect(a.next()).not.toBe(b.next());
  });

  test("child does not interleave with parent's future sequence", () => {
    const parent = createRng(42);
    const child = parent.split();
    // Mutate the child and ensure parent's sequence is unaffected.
    const parentState = parent.state();
    for (let i = 0; i < 1000; i++) child.next();
    expect(parent.state()).toEqual(parentState);
  });

  test("two splits from the same parent at different points yield different children", () => {
    const parent = createRng(42);
    const child1 = parent.split();
    const child2 = parent.split();
    const seq1 = Array.from({ length: 20 }, () => child1.next());
    const seq2 = Array.from({ length: 20 }, () => child2.next());
    expect(seq1).not.toEqual(seq2);
  });
});

describe("createRng — distribution sanity", () => {
  test("int(0, 9) over 10000 iterations: every digit appears at least 800 times", () => {
    const rng = createRng(0xbadbeef);
    const counts = new Array<number>(10).fill(0);
    for (let i = 0; i < 10_000; i++) {
      const v = rng.int(0, 9);
      counts[v] = (counts[v] ?? 0) + 1;
    }
    for (const c of counts) {
      expect(c).toBeGreaterThan(800);
      expect(c).toBeLessThan(1200);
    }
  });
});
