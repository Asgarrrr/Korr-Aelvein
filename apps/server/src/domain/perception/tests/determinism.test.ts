// Determinism pinning for computeFov, same regimen as the dungeon styles:
// (1) two runs on the same input are byte-identical, (2) FNV-1a hash
// canaries over generated levels pin the exact visible set. computeFov is
// all-integer (rational slopes via cross-multiplication), so any drift
// here is an algorithm change, not a platform artefact — don't re-pin
// without understanding what moved.

import { describe, expect, test } from "bun:test";
import { generateLevel, type StyleId } from "../../dungeon/index";
import { createRng } from "../../rng/index";
import { computeFov } from "../index";

const RADIUS = 12;

// FNV-1a 32-bit over the mask bytes. Same signature scheme as
// `dungeon/styles/*/tests/determinism.test.ts`.
function maskHash(mask: Uint8Array): number {
  let h = 2166136261 | 0;
  for (const v of mask) h = Math.imul(h ^ v, 16777619) | 0;
  return h >>> 0;
}

function fovFromSpawn(seed: number, style: StyleId): Uint8Array {
  const level = generateLevel(createRng(seed), 80, 30, style);
  if (level.spawn === null) {
    throw new Error(`test: ${style} seed ${seed} produced no spawn`);
  }
  return computeFov(level, level.spawn[0], level.spawn[1], RADIUS);
}

const STYLES: ReadonlyArray<StyleId> = ["rim", "caverns"];

describe("computeFov determinism — repeat runs", () => {
  for (const style of STYLES) {
    for (const seed of [0, 7, 42]) {
      test(`${style} seed ${seed}: two runs produce byte-identical masks`, () => {
        expect(Array.from(fovFromSpawn(seed, style))).toEqual(
          Array.from(fovFromSpawn(seed, style)),
        );
      });
    }
  }
});

describe("computeFov — pinned hash canaries (rim 80×30, radius 12)", () => {
  // 20 seeds hashed, 4 pinned. If a pin drifts, the visible set changed:
  // either accept the new geometry on purpose (update the pin in the same
  // commit) or hunt the regression.
  const hashes: ReadonlyArray<number> = (() => {
    const out: number[] = [];
    for (let s = 0; s < 20; s++) out.push(maskHash(fovFromSpawn(s, "rim")));
    return out;
  })();

  test("seed 0 hash is pinned", () => {
    expect(hashes[0]).toBe(0x8e7e1c5b);
  });
  test("seed 1 hash is pinned", () => {
    expect(hashes[1]).toBe(0xa6bce14a);
  });
  test("seed 7 hash is pinned", () => {
    expect(hashes[7]).toBe(0xf3e0c5fd);
  });
  test("seed 19 hash is pinned", () => {
    expect(hashes[19]).toBe(0x758db41d);
  });

  test("≥ 12 of 20 seeds produce distinct hashes (sanity)", () => {
    // Lower bar than the level-hash equivalents on purpose: rim spawns
    // cluster around the level centre, and seeds whose spawn room has the
    // same near-field geometry produce byte-identical masks (verified, not
    // hash collisions — e.g. seeds 2/17/19 share spawn (40,14) and an
    // 88-tile FOV). 15 distinct observed at pin time.
    expect(new Set(hashes).size).toBeGreaterThanOrEqual(12);
  });
});

describe("computeFov — pinned hash canaries (caverns 80×30, radius 12)", () => {
  test("seed 42 hash is pinned", () => {
    expect(maskHash(fovFromSpawn(42, "caverns"))).toBe(0xe9ec0b08);
  });
});
