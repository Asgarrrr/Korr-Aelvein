/**
 * Field-of-view — symmetric shadowcasting (Albert Ford's formulation).
 *
 * Public surface: `computeFov(level, ox, oy, radius)` returns a row-major
 * `Uint8Array` mask (`width × height`, 0 = hidden, 1 = visible) and
 * `isOpaque(tile)`, the single sight-blocking predicate.
 *
 * Why this algorithm and not the better-known recursive shadowcasting
 * (Bergström), permissive FOV, naive raycasting, or rot-js:
 *
 *   - **Symmetry.** A floor tile sees the origin iff the origin sees it —
 *     the underlying model: the centre-to-centre segment enters no opaque
 *     tile's OPEN inscribed diamond (vertices on edge midpoints — not the
 *     full cell square), and is not *pinched*: a line that only touches
 *     diamond boundaries stays valid while every touched diamond lies on
 *     the same flank; grazing diamonds on both flanks of the ray is
 *     dropped, symmetrically from both endpoints, by the sector
 *     bookkeeping. Exact oracle: `tests/properties.test.ts`. Bergström's
 *     variant and raycasting are both asymmetric, which becomes unfair
 *     the day mobs perceive the player through the same primitive.
 *     Permissive FOV is symmetric but ~10× slower and reveals too much
 *     around corners. rot-js (2.56 MB toolkit, non-symmetric FOV) fails
 *     both the dependency rules and the symmetry requirement.
 *   - **Determinism by construction.** Slopes are exact rationals
 *     (`Frac`, integer numerator / positive integer denominator) compared
 *     by cross-multiplication; rounding is integer floor/ceil division.
 *     Zero floats → bit-identical output on any engine, same contract as
 *     the sfc32 RNG.
 *   - **Expansive walls, zero artefacts** — the remaining Milazzo
 *     properties — fall out of the corner-slope construction
 *     (`tileSlope`).
 *
 * Reference: https://www.albertford.com/shadowcasting/ — structure
 * (quadrant scan, Row, slope mutation rules) follows the article; the
 * recursion is replaced with an explicit stack (house idiom: `pop()` +
 * `undefined` guard) and a euclidean range cut (`depth² + col² ≤ r²`,
 * integer) bounds the scan. The range predicate is symmetric in itself,
 * so the cut preserves the symmetry property.
 *
 * Purity: reads `level.grid` only, allocates the mask, no RNG, no
 * mutation of inputs. Hot-loop tile reads use raw indexing + `undefined`
 * guard (out-of-bounds = opaque) instead of `getTile` — the throw-path
 * is wrong in a loop where off-grid probes are expected and benign.
 */

import type { Level, Tile } from "../dungeon/index";
import { TILE_DOOR, TILE_FLOOR, TILE_WALL } from "../dungeon/index";

/**
 * Single chokepoint for "does this tile block sight?". Doors block while
 * the tile type has no open/closed state — when door state lands, this
 * predicate (and only this predicate) grows the lookup. Call sites must
 * then also recompute perception on door-state change (see
 * `domain/game/perception.ts`) — today only player movement triggers it.
 *
 * TODO(door-state): the moment this predicate reads an open/closed flag,
 * add the regression test — open a door adjacent to a stationary player,
 * assert a cell behind it flips visible in the SAME tick. Today's prose
 * warnings (here + `game/perception.ts`) are unenforced.
 */
export function isOpaque(tile: Tile): boolean {
  return tile === TILE_WALL || tile === TILE_DOOR;
}

function isTileValue(value: number): value is Tile {
  return value === TILE_WALL || value === TILE_FLOOR || value === TILE_DOOR;
}

/**
 * Raw-index read with fail-closed semantics: out-of-bounds and corrupt
 * tile values are opaque. Perception must never reveal past the edge of
 * the world.
 */
function opaqueAt(level: Level, x: number, y: number): boolean {
  const { width, height, tiles } = level.grid;
  if (x < 0 || y < 0 || x >= width || y >= height) return true;
  const raw = tiles[y * width + x];
  if (raw === undefined || !isTileValue(raw)) return true;
  return isOpaque(raw);
}

/**
 * Exact rational slope. `den > 0` always (denominators are `2 × depth`
 * with `depth ≥ 1`, or the literal 1), so cross-multiplied comparisons
 * never flip sign.
 */
type Frac = {
  readonly num: number;
  readonly den: number;
};

/**
 * One row of a quadrant scan: tiles at distance `depth` whose angular
 * sector is `(start, end)`. `start` is mutated as walls split the sector,
 * so the field stays writable; `end` is fixed for the row's lifetime.
 */
type Row = {
  readonly depth: number;
  start: Frac;
  readonly end: Frac;
};

type Quadrant = "north" | "east" | "south" | "west";

const QUADRANTS: readonly [Quadrant, Quadrant, Quadrant, Quadrant] = [
  "north",
  "east",
  "south",
  "west",
];

/** Map quadrant-local `(depth, col)` to grid coordinates. */
function transformQuadrant(
  quadrant: Quadrant,
  ox: number,
  oy: number,
  depth: number,
  col: number,
): readonly [number, number] {
  switch (quadrant) {
    case "north":
      return [ox + col, oy - depth];
    case "east":
      return [ox + depth, oy + col];
    case "south":
      return [ox + col, oy + depth];
    case "west":
      return [ox - depth, oy + col];
    default: {
      const _exhaustive: never = quadrant;
      throw new Error(
        `transformQuadrant: unhandled quadrant ${String(_exhaustive)}`,
      );
    }
  }
}

/**
 * Slope of the line from the origin's centre to the near corner of tile
 * `(depth, col)` — the ×2 trick from the article: corner coordinates are
 * half-integers, so `(2·col − 1) / (2·depth)` keeps everything integral.
 */
function tileSlope(depth: number, col: number): Frac {
  return { num: 2 * col - 1, den: 2 * depth };
}

/** Integer floor division, `den > 0`. */
function floorDiv(num: number, den: number): number {
  const q = Math.trunc(num / den);
  return num % den !== 0 && num < 0 ? q - 1 : q;
}

/** Integer ceiling division, `den > 0`. */
function ceilDiv(num: number, den: number): number {
  const q = Math.trunc(num / den);
  return num % den !== 0 && num > 0 ? q + 1 : q;
}

/** First column of a row: `depth × slope`, rounding ties toward +∞. */
function minCol(depth: number, slope: Frac): number {
  return floorDiv(2 * depth * slope.num + slope.den, 2 * slope.den);
}

/** Last column of a row: `depth × slope`, rounding ties toward −∞. */
function maxCol(depth: number, slope: Frac): number {
  return ceilDiv(2 * depth * slope.num - slope.den, 2 * slope.den);
}

/**
 * True when the *centre* of tile `(depth, col)` lies inside the sector
 * `[start, end]` — `col ≥ depth × start` and `col ≤ depth × end`, compared
 * by cross-multiplication (both `den > 0`). This is the check that makes
 * floor visibility symmetric.
 */
function isSymmetric(
  depth: number,
  col: number,
  start: Frac,
  end: Frac,
): boolean {
  return (
    col * start.den >= depth * start.num && col * end.den <= depth * end.num
  );
}

/**
 * Scan one quadrant, marking visible tiles into `mask`. Explicit
 * `Array<Row>` stack instead of recursion — wall segments push the
 * narrowed child row, a floor-terminated row pushes its full-sector
 * child. LIFO order differs from the article's recursion order; the
 * visited set is identical and writes are idempotent (`mask[i] = 1`).
 */
function scanQuadrant(
  level: Level,
  ox: number,
  oy: number,
  radius: number,
  quadrant: Quadrant,
  mask: Uint8Array,
): void {
  const { width, height } = level.grid;
  const radiusSq = radius * radius;
  const stack: Array<Row> = [
    { depth: 1, start: { num: -1, den: 1 }, end: { num: 1, den: 1 } },
  ];
  while (stack.length > 0) {
    const row = stack.pop();
    if (row === undefined) break;
    if (row.depth > radius) continue;
    const first = minCol(row.depth, row.start);
    const last = maxCol(row.depth, row.end);
    // `undefined` = no previous tile yet (first column of the row).
    let prevOpaque: boolean | undefined;
    for (let col = first; col <= last; col++) {
      const [tx, ty] = transformQuadrant(quadrant, ox, oy, row.depth, col);
      const opaque = opaqueAt(level, tx, ty);
      const inRange = row.depth * row.depth + col * col <= radiusSq;
      if (
        inRange &&
        (opaque || isSymmetric(row.depth, col, row.start, row.end)) &&
        tx >= 0 &&
        ty >= 0 &&
        tx < width &&
        ty < height
      ) {
        mask[ty * width + tx] = 1;
      }
      if (prevOpaque === true && !opaque) {
        row.start = tileSlope(row.depth, col);
      }
      if (prevOpaque === false && opaque) {
        stack.push({
          depth: row.depth + 1,
          start: row.start,
          end: tileSlope(row.depth, col),
        });
      }
      prevOpaque = opaque;
    }
    if (prevOpaque === false) {
      stack.push({
        depth: row.depth + 1,
        start: row.start,
        end: row.end,
      });
    }
  }
}

/**
 * Compute the field of view from `(ox, oy)` out to `radius` (euclidean,
 * inclusive: a tile is in range when `dx² + dy² ≤ radius²`). Returns a
 * fresh `width × height` mask, row-major, 1 = visible. The origin is
 * always visible. Throws when the origin is off-grid — an off-grid
 * observer is a state-machine bug upstream, not a perception question.
 * Throws on a non-integer `radius`: a float would reach `radiusSq` and
 * the `depth > radius` cut, voiding the integer-only determinism contract
 * the module guarantees — métiers modulating vision must round first.
 */
export function computeFov(
  level: Level,
  ox: number,
  oy: number,
  radius: number,
): Uint8Array {
  const { width, height } = level.grid;
  if (ox < 0 || oy < 0 || ox >= width || oy >= height) {
    throw new Error(
      `computeFov: origin (${ox}, ${oy}) out of bounds (${width}x${height})`,
    );
  }
  if (!Number.isInteger(radius)) {
    throw new Error(
      `computeFov: radius ${radius} must be an integer (a float voids the determinism contract)`,
    );
  }
  const mask = new Uint8Array(width * height);
  mask[oy * width + ox] = 1;
  if (radius <= 0) return mask;
  for (const quadrant of QUADRANTS) {
    scanQuadrant(level, ox, oy, radius, quadrant, mask);
  }
  return mask;
}
