import { cloneTiles, fillBorder } from "../../grid";
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
    const { W, H, tiles, cap } = cloneTiles(level.grid);

    // Sample every cell (including the border) so the RNG-draw count is
    // exactly W*H — independent of border width, stable under determinism.
    for (let i = 0; i < cap; i++) {
      tiles[i] = rng.chance(wallProbability) ? TILE_WALL : TILE_FLOOR;
    }
    fillBorder(tiles, W, H, TILE_WALL);

    return { ...level, grid: { ...level.grid, tiles } };
  };
}
