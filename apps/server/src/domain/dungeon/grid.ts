// Hot-loop convention: passes (later phases) bypass `setTile` — they
// `new Uint8Array(level.grid.tiles)` once per pass and mutate via
// `tiles[idx(x, y, w)] = TILE_X` directly. `setTile` is for one-off /
// external use where the per-call copy cost is negligible.

import {
  type Grid,
  TILE_DOOR,
  TILE_FLOOR,
  TILE_WALL,
  type Tile,
} from "./types";

// 4-neighborhood offsets in N/E/S/W order. Hot-loop BFS sites (passes) iterate
// these directly to avoid the per-cell allocation cost of `neighbors4()` (which
// builds a fresh tuple array on every call). Declared as a 4-tuple type so that
// DX4[0]..DX4[3] narrow to `number` (no `noUncheckedIndexedAccess` undefined).
export const DX4: readonly [number, number, number, number] = [0, 1, 0, -1];
export const DY4: readonly [number, number, number, number] = [-1, 0, 1, 0];

export function idx(x: number, y: number, width: number): number {
  return y * width + x;
}

export function inBounds(
  x: number,
  y: number,
  grid: Pick<Grid, "width" | "height">,
): boolean {
  return x >= 0 && y >= 0 && x < grid.width && y < grid.height;
}

function isTile(value: number): value is Tile {
  return value === TILE_WALL || value === TILE_FLOOR || value === TILE_DOOR;
}

export function getTile(grid: Grid, x: number, y: number): Tile {
  if (!inBounds(x, y, grid)) {
    throw new Error(
      `getTile: (${x}, ${y}) out of bounds (${grid.width}x${grid.height})`,
    );
  }
  const raw = grid.tiles[idx(x, y, grid.width)];
  if (raw === undefined || !isTile(raw)) {
    throw new Error(`getTile: invalid tile value ${raw} at (${x}, ${y})`);
  }
  return raw;
}

export function setTile(grid: Grid, x: number, y: number, tile: Tile): Grid {
  if (!inBounds(x, y, grid)) {
    throw new Error(
      `setTile: (${x}, ${y}) out of bounds (${grid.width}x${grid.height})`,
    );
  }
  const tiles = new Uint8Array(grid.tiles);
  tiles[idx(x, y, grid.width)] = tile;
  return { width: grid.width, height: grid.height, tiles };
}

export function neighbors4(
  x: number,
  y: number,
): ReadonlyArray<readonly [number, number]> {
  return [
    [x, y - 1],
    [x + 1, y],
    [x, y + 1],
    [x - 1, y],
  ];
}

export function neighbors8(
  x: number,
  y: number,
): ReadonlyArray<readonly [number, number]> {
  return [
    [x - 1, y - 1],
    [x, y - 1],
    [x + 1, y - 1],
    [x - 1, y],
    [x + 1, y],
    [x - 1, y + 1],
    [x, y + 1],
    [x + 1, y + 1],
  ];
}
