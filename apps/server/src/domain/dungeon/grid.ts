// Hot-loop convention: passes that write tiles do NOT call a per-cell setter.
// They clone the grid's tiles once (see `cloneTiles` below), then mutate via
// `tiles[idx(x, y, w)] = TILE_X` — or, in the very hottest loops, inline
// `y * w + x` to drop the function-call overhead entirely.
//
// `DX4` / `DY4` are 4-tuples (not generic `number[]`) so that `DX4[0]..DX4[3]`
// narrow under `noUncheckedIndexedAccess`. Hot BFS sites read them via an
// indexed `for (let k = 0; k < 4; k++)` loop; the per-iteration `undefined`
// guard is the cost of the no-`!` / no-`as` project rule (a bench-rejected
// `assertDefined` helper has its own write-up in project memory; a
// `for (const [dx, dy] of DIRS)` destructure pattern was also tried and lost
// 2.2-2.4× to the indexed `for-k` form — `bench/place-cavern-stairs.bench.ts`).

import {
  type Grid,
  TILE_DOOR,
  TILE_FLOOR,
  TILE_WALL,
  type Tile,
} from "./types";

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

// Per-pass starting point for any write-pass. Returns a fresh copy of the
// grid's tiles plus the width/height/cap commonly destructured at the top of
// every pass. The pass then mutates `tiles` in place and rewraps it in a new
// Grid on return — preserving the pure `(state, action) → state` shape.
//
// Explicit `Uint8Array<ArrayBuffer>` (over the inferred default) so callers
// that ping-pong with a freshly allocated `new Uint8Array(cap)` (iterateCA)
// can swap buffers without TS variance friction.
export function cloneTiles(grid: Grid): {
  readonly W: number;
  readonly H: number;
  readonly tiles: Uint8Array<ArrayBuffer>;
  readonly cap: number;
} {
  return {
    W: grid.width,
    H: grid.height,
    tiles: new Uint8Array(grid.tiles),
    cap: grid.width * grid.height,
  };
}

// Write `tile` on the 4 edges of an H×W grid stored row-major. Caverns passes
// rely on a closed wall border (seedCA enforces it once; iterateCA reapplies
// it every step so the interior loop can skip bounds checks).
export function fillBorder(
  tiles: Uint8Array,
  width: number,
  height: number,
  tile: Tile,
): void {
  const lastRow = (height - 1) * width;
  const lastCol = width - 1;
  for (let x = 0; x < width; x++) {
    tiles[x] = tile;
    tiles[lastRow + x] = tile;
  }
  for (let y = 1; y < height - 1; y++) {
    const yBase = y * width;
    tiles[yBase] = tile;
    tiles[yBase + lastCol] = tile;
  }
}

// Pre-allocated scratch buffers for a 4-connected BFS that tracks per-cell
// distance: `visited` (1 byte/cell), flat queue `queueX`/`queueY`/`queueD`.
// Used by `addLoops.runBfs` and `placeCavernStairs`. BFS sites with a
// different shape (e.g. `connectComponents`' wave uses `parent` instead of
// `queueD`; `flood` uses `number[]` xs/ys) allocate inline.
export function makeBfsScratch(cap: number): {
  readonly visited: Uint8Array;
  readonly queueX: Int32Array;
  readonly queueY: Int32Array;
  readonly queueD: Int32Array;
} {
  return {
    visited: new Uint8Array(cap),
    queueX: new Int32Array(cap),
    queueY: new Int32Array(cap),
    queueD: new Int32Array(cap),
  };
}
