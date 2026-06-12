// Adversarial property tests for symmetric shadowcasting, cross-checked
// against an *exact* reference model — NOT a Bresenham line walk, whose
// discretisation diverges from the shadowcasting model and produces false
// reds. The reference is the algorithm's own definition of visibility
// (https://www.albertford.com/shadowcasting/ — "when scanning wall tiles,
// we model those as diamonds inscribed in the tile"):
//
//   a floor tile B is visible from floor tile A iff the segment joining
//   the two tile centres (1) enters the OPEN inscribed diamond of no
//   opaque cell, and (2) is not *pinched*: touching diamond vertices is
//   allowed, but only while every touched diamond sits on the same side
//   of the sight line. A ray grazing one diamond's right vertex and a
//   deeper diamond's left vertex (both exactly on the line) is dropped
//   by the algorithm's sector bookkeeping — the inclusive boundary ray
//   created by the first wall is overwritten when the second wall lands
//   exactly on it — and it is dropped symmetrically from both endpoints.
//
// Diamonds, not full squares: the algorithm's occlusion slopes run
// through the midpoints of tile edges, so a sight line may clip the
// corner region of a wall's square (outside the diamond) and still see
// through — a square-interior reference flags those as false positives.
//
// Computed in doubled integer coordinates (tile (x, y) has centre
// (2x+1, 2y+1), inscribed diamond |X−(2x+1)| + |Y−(2y+1)| < 1) with
// rational t-interval clipping compared by cross-multiplication — exact,
// no floats, same arithmetic discipline as the implementation under test.

import { describe, expect, test } from "bun:test";
import type { Level } from "../../dungeon/index";
import { TILE_DOOR, TILE_FLOOR, TILE_WALL } from "../../dungeon/index";
import { createRng, type Rng } from "../../rng/index";
import { computeFov } from "../index";

// ─── Exact segment-vs-grid reference ─────────────────────────────────────────

/** Rational bound `num / den` with `den > 0`. */
type Bound = { readonly num: number; readonly den: number };

/** Strict `a < b` by cross-multiplication (positive denominators). */
function ltBound(a: Bound, b: Bound): boolean {
  return a.num * b.den < b.num * a.den;
}

/** Non-strict `a ≤ b` by cross-multiplication (positive denominators). */
function leBound(a: Bound, b: Bound): boolean {
  return a.num * b.den <= b.num * a.den;
}

/**
 * Does the segment from `(px, py)` to `(qx, qy)` (t ∈ [0, 1]) intersect
 * the diamond `|X − cx| + |Y − cy| {< | ≤} 1` (×2 coordinates, so the
 * diamond vertices sit on the tile's edge midpoints)? Every input is an
 * integer. `closed = false` tests the open interior (a real crossing),
 * `closed = true` includes the boundary (crossing or touch).
 *
 * The diamond is the intersection of four half-planes
 * `s1·(X − cx) + s2·(Y − cy) {< | ≤} 1`, s1, s2 ∈ {−1, +1}. Substituting
 * X = px + t·dx, Y = py + t·dy gives four linear constraints `α·t ⋚ β`
 * clipped into one rational t-interval.
 */
function segmentHitsDiamond(
  px: number,
  py: number,
  qx: number,
  qy: number,
  cx: number,
  cy: number,
  closed: boolean,
): boolean {
  const dx = qx - px;
  const dy = qy - py;
  const ux = px - cx;
  const uy = py - cy;

  const constraints: Array<readonly [number, number]> = [];
  for (const s1 of [-1, 1]) {
    for (const s2 of [-1, 1]) {
      constraints.push([s1 * dx + s2 * dy, 1 - s1 * ux - s2 * uy]);
    }
  }

  // t-interval (lo, hi) where the segment is inside the diamond.
  // null = unconstrained (±∞). Clipped against each `alpha·t < beta`
  // half-plane (or ≤ when closed) in this scope, not a helper closure —
  // TS does not track null-narrowing through closure mutation.
  let lo: Bound | null = null;
  let hi: Bound | null = null;
  for (const [alpha, beta] of constraints) {
    if (alpha === 0) {
      if (closed ? beta < 0 : beta <= 0) return false;
    } else if (alpha > 0) {
      const bound: Bound = { num: beta, den: alpha };
      if (hi === null || ltBound(bound, hi)) hi = bound;
    } else {
      const bound: Bound = { num: -beta, den: -alpha };
      if (lo === null || ltBound(lo, bound)) lo = bound;
    }
  }

  // Open: feasible set (lo, hi) ∩ [0, 1] needs lo < hi, hi > 0, lo < 1.
  // Closed: [lo, hi] ∩ [0, 1] needs lo ≤ hi, hi ≥ 0, lo ≤ 1.
  if (lo !== null && hi !== null) {
    const ordered = closed ? leBound(lo, hi) : ltBound(lo, hi);
    if (!ordered) return false;
  }
  if (hi !== null && (closed ? hi.num < 0 : hi.num <= 0)) return false;
  if (lo !== null && (closed ? lo.num > lo.den : lo.num >= lo.den)) {
    return false;
  }
  return true;
}

function opaqueRaw(level: Level, x: number, y: number): boolean {
  const raw = level.grid.tiles[y * level.grid.width + x];
  return raw !== TILE_FLOOR;
}

/**
 * Reference visibility between two floor-tile centres: scan every opaque
 * cell. Blocked when the centre-to-centre segment enters an open inscribed
 * diamond, OR when it is pinched — touching diamond boundaries on both
 * sides of the line. A touch is a closed-hit without an open-hit; the
 * touched diamond's centre is never on the line (a centre on the line is
 * an interior crossing), so its side is the sign of one cross product.
 * O(cells) per query — fine for the small grids used here.
 */
function refVisible(
  level: Level,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): boolean {
  const { width, height } = level.grid;
  const px = 2 * ax + 1;
  const py = 2 * ay + 1;
  const qx = 2 * bx + 1;
  const qy = 2 * by + 1;
  let touchLeft = false;
  let touchRight = false;
  for (let cy = 0; cy < height; cy++) {
    for (let cx = 0; cx < width; cx++) {
      if (!opaqueRaw(level, cx, cy)) continue;
      const dcx = 2 * cx + 1;
      const dcy = 2 * cy + 1;
      if (segmentHitsDiamond(px, py, qx, qy, dcx, dcy, false)) return false;
      if (segmentHitsDiamond(px, py, qx, qy, dcx, dcy, true)) {
        const cross = (qx - px) * (dcy - py) - (qy - py) * (dcx - px);
        if (cross === 0) return false;
        if (cross > 0) touchLeft = true;
        else touchRight = true;
      }
    }
  }
  return !(touchLeft && touchRight);
}

// ─── Random fixtures (seeded — failures reproduce) ───────────────────────────

function randomLevel(rng: Rng, width: number, height: number): Level {
  const tiles = new Uint8Array(width * height);
  for (let i = 0; i < tiles.length; i++) {
    if (rng.chance(0.25)) {
      tiles[i] = rng.chance(0.15) ? TILE_DOOR : TILE_WALL;
    } else {
      tiles[i] = TILE_FLOOR;
    }
  }
  return {
    grid: { width, height, tiles },
    rooms: [],
    spawn: null,
    downStairs: null,
  };
}

function floorCells(level: Level): Array<readonly [number, number]> {
  const out: Array<readonly [number, number]> = [];
  for (let y = 0; y < level.grid.height; y++) {
    for (let x = 0; x < level.grid.width; x++) {
      if (!opaqueRaw(level, x, y)) out.push([x, y]);
    }
  }
  return out;
}

const W = 16;
const H = 12;
const RADIUS = 24; // covers the whole 16×12 grid — range cut tested separately

describe("computeFov ≡ exact centre-segment reference (floor tiles)", () => {
  for (const seed of [1, 2, 3, 7, 42, 0xc0ffee]) {
    test(`seed ${seed}: every in-range floor tile matches the reference`, () => {
      const rng = createRng(seed);
      const level = randomLevel(rng, W, H);
      const floors = floorCells(level);
      if (floors.length === 0) return;
      const [ox, oy] = rng.pick(floors);
      const mask = computeFov(level, ox, oy, RADIUS);
      for (const [x, y] of floors) {
        const got = mask[y * W + x];
        const want = refVisible(level, ox, oy, x, y) ? 1 : 0;
        if (got !== want) {
          throw new Error(
            `seed ${seed}: fov(${ox},${oy})→(${x},${y}) = ${got}, reference says ${want}`,
          );
        }
      }
    });
  }
});

describe("computeFov — symmetry on floor tiles", () => {
  for (const seed of [5, 11, 0xbeef]) {
    test(`seed ${seed}: A sees B ⟺ B sees A`, () => {
      const rng = createRng(seed);
      const level = randomLevel(rng, W, H);
      const floors = floorCells(level);
      if (floors.length < 2) return;
      // A dozen random origins, all pairs cross-checked.
      const origins: Array<readonly [number, number]> = [];
      for (let i = 0; i < 12; i++) origins.push(rng.pick(floors));
      const masks = origins.map(([x, y]) => computeFov(level, x, y, RADIUS));
      for (const [i, [ax, ay]] of origins.entries()) {
        for (const [j, [bx, by]] of origins.entries()) {
          const mi = masks[i];
          const mj = masks[j];
          if (mi === undefined || mj === undefined) {
            throw new Error("test: mask index out of range");
          }
          expect(mi[by * W + bx]).toBe(mj[ay * W + ax] === 1 ? 1 : 0);
        }
      }
    });
  }
});

describe("computeFov — range cut", () => {
  for (const seed of [4, 9]) {
    test(`seed ${seed}: nothing beyond the euclidean radius is lit`, () => {
      const rng = createRng(seed);
      const level = randomLevel(rng, W, H);
      const floors = floorCells(level);
      if (floors.length === 0) return;
      const [ox, oy] = rng.pick(floors);
      const radius = 4;
      const mask = computeFov(level, ox, oy, radius);
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          if ((x - ox) ** 2 + (y - oy) ** 2 > radius * radius) {
            expect(mask[y * W + x]).toBe(0);
          }
        }
      }
    });
  }

  test("range-limited mask is the unbounded mask intersected with the disc", () => {
    const rng = createRng(13);
    const level = randomLevel(rng, W, H);
    const floors = floorCells(level);
    if (floors.length === 0) return;
    const [ox, oy] = rng.pick(floors);
    const radius = 5;
    const limited = computeFov(level, ox, oy, radius);
    const unbounded = computeFov(level, ox, oy, RADIUS);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const inDisc = (x - ox) ** 2 + (y - oy) ** 2 <= radius * radius;
        const want = inDisc && unbounded[y * W + x] === 1 ? 1 : 0;
        expect(limited[y * W + x]).toBe(want);
      }
    }
  });
});
