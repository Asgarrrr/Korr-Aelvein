import { type Pass, TILE_FLOOR, TILE_WALL } from "../../types";

export type IterateCAParams = {
  readonly iterations?: number;
  readonly birthLimit?: number;
  readonly survivalLimit?: number;
};

const DEFAULT_ITERATIONS = 5;
const DEFAULT_BIRTH_LIMIT = 5;
const DEFAULT_SURVIVAL_LIMIT = 4;

export function iterateCA(params: IterateCAParams = {}): Pass {
  const iterations = params.iterations ?? DEFAULT_ITERATIONS;
  const birthLimit = params.birthLimit ?? DEFAULT_BIRTH_LIMIT;
  const survivalLimit = params.survivalLimit ?? DEFAULT_SURVIVAL_LIMIT;
  if (!Number.isInteger(iterations) || iterations < 0) {
    throw new Error(
      `iterateCA: iterations must be a non-negative integer (got ${iterations})`,
    );
  }
  if (!Number.isInteger(birthLimit) || birthLimit < 0 || birthLimit > 8) {
    throw new Error(
      `iterateCA: birthLimit must be an integer in [0, 8] (got ${birthLimit})`,
    );
  }
  if (
    !Number.isInteger(survivalLimit) ||
    survivalLimit < 0 ||
    survivalLimit > 8
  ) {
    throw new Error(
      `iterateCA: survivalLimit must be an integer in [0, 8] (got ${survivalLimit})`,
    );
  }

  // State-transition lookup table. Indexed by `here * 9 + wallCount`, returns
  // the next-state tile. Replaces a 2-branch ternary chain (~6 instructions)
  // with a single typed-array load.
  //
  // Built once per pass instantiation, captured by the returned closure.
  // Layout: LUT[0..8] = rules for currently-WALL cell (survival)
  //         LUT[9..17] = rules for currently-FLOOR cell (birth)
  const LUT = new Uint8Array(18);
  for (let wc = 0; wc <= 8; wc++) {
    LUT[TILE_WALL * 9 + wc] = wc >= survivalLimit ? TILE_WALL : TILE_FLOOR;
    LUT[TILE_FLOOR * 9 + wc] = wc >= birthLimit ? TILE_WALL : TILE_FLOOR;
  }

  return (level) => {
    const { width: W, height: H } = level.grid;
    let prev = new Uint8Array(level.grid.tiles);
    let next = new Uint8Array(W * H);
    const lastRow = (H - 1) * W;
    const lastCol = W - 1;

    for (let step = 0; step < iterations; step++) {
      // Border-force is identity at every iteration (OOB-as-WALL + project
      // requirement). Write WALL directly to all 4 edges so the inner loop
      // can specialise to "interior only" — no bounds checks, no idx() call,
      // 8 explicit neighbor reads against row-base locals.
      for (let x = 0; x < W; x++) {
        next[x] = TILE_WALL;
        next[lastRow + x] = TILE_WALL;
      }
      for (let y = 1; y < H - 1; y++) {
        const yBase = y * W;
        next[yBase] = TILE_WALL;
        next[yBase + lastCol] = TILE_WALL;
      }

      // Interior cells (1 ≤ x ≤ W-2, 1 ≤ y ≤ H-2): all 8 neighbors in bounds.
      //
      // Branch-free Moore count: TILE_WALL = 0, TILE_FLOOR = 1, so summing the
      // 8 neighbor bytes gives the *floor* count, and wallCount = 8 - sum. All
      // operands are guaranteed in {0, 1} during caverns pipeline (seedCA +
      // prior iterateCA only write those two values). Replaces 8 compare+cmov
      // with 7 adds — significant on the hot path.
      //
      // The combined undefined-guard narrows all 9 reads to `number` after the
      // short-circuit, no per-read guard inside the inner loop.
      for (let y = 1; y < H - 1; y++) {
        const yBase = y * W;
        const yBaseAbove = yBase - W;
        const yBaseBelow = yBase + W;
        for (let x = 1; x < W - 1; x++) {
          const here = prev[yBase + x];
          const a = prev[yBaseAbove + x - 1];
          const b = prev[yBaseAbove + x];
          const c = prev[yBaseAbove + x + 1];
          const d = prev[yBase + x - 1];
          const e = prev[yBase + x + 1];
          const f = prev[yBaseBelow + x - 1];
          const g = prev[yBaseBelow + x];
          const h = prev[yBaseBelow + x + 1];
          if (
            here === undefined ||
            a === undefined ||
            b === undefined ||
            c === undefined ||
            d === undefined ||
            e === undefined ||
            f === undefined ||
            g === undefined ||
            h === undefined
          ) {
            throw new Error("iterateCA: unreachable Moore read");
          }
          const wallCount = 8 - (a + b + c + d + e + f + g + h);
          next[yBase + x] = LUT[here * 9 + wallCount] ?? TILE_WALL;
        }
      }

      const swap = prev;
      prev = next;
      next = swap;
    }

    return { ...level, grid: { ...level.grid, tiles: prev } };
  };
}
