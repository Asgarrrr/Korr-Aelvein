import { type Pass, TILE_FLOOR, TILE_WALL } from "../../types";

export type SeedCAParams = {
  readonly wallProbability?: number;
};

const DEFAULT_WALL_PROBABILITY = 0.45;

export function seedCA(params: SeedCAParams = {}): Pass {
  const wallProbability = params.wallProbability ?? DEFAULT_WALL_PROBABILITY;
  if (!Number.isFinite(wallProbability)) {
    throw new Error(
      `seedCA: wallProbability must be finite (got ${wallProbability})`,
    );
  }
  if (wallProbability < 0 || wallProbability > 1) {
    throw new Error(
      `seedCA: wallProbability must be in [0, 1] (got ${wallProbability})`,
    );
  }

  return (level, rng) => {
    const { width: W, height: H } = level.grid;
    const tiles = new Uint8Array(level.grid.tiles);
    const cap = W * H;

    // Sample every cell (including the border) so the number of RNG draws is
    // exactly W*H — deterministic and independent of border width. Single flat
    // pass over the typed array (no nested xy loop, no idx() function call):
    // JSC's DFG specialises Uint8Array indexed stores on a counted loop.
    for (let i = 0; i < cap; i++) {
      tiles[i] = rng.chance(wallProbability) ? TILE_WALL : TILE_FLOOR;
    }
    // Border to WALL unconditionally, enclosing the cave.
    const lastRow = (H - 1) * W;
    for (let x = 0; x < W; x++) {
      tiles[x] = TILE_WALL;
      tiles[lastRow + x] = TILE_WALL;
    }
    for (let y = 1; y < H - 1; y++) {
      const yBase = y * W;
      tiles[yBase] = TILE_WALL;
      tiles[yBase + W - 1] = TILE_WALL;
    }

    return { ...level, grid: { ...level.grid, tiles } };
  };
}
