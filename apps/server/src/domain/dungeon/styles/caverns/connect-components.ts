import { cloneTiles, DX4, DY4 } from "../../grid";
import { type Pass, TILE_FLOOR, TILE_WALL } from "../../types";

// Connect every floor component into a single 4-connected region.
//
// Pass 1 — labelComponents: single scanline pass that flood-fills each floor
// component, writing `compIdx[i] = label` (1..N for floor cells, 0 for walls)
// and tracking each component's `size`. Anchor = argmax-by-size with strict
// `>` so ties resolve to the first-encountered (scanline) component — same
// tiebreak the previous descending stable-sort produced.
//
// Pass 2 — multi-source BFS over the whole grid, seeded from every anchor
// tile. Walls are passable; each tile is visited at most once → O(W·H). The
// first time the wave reaches a not-yet-merged satellite, walk `parent[]`
// back to an anchor seed, carving any walls on the path. The carve is — by
// construction — the shortest 4-path from satellite to anchor.
//
// Assumes the input grid contains no TILE_DOOR (caverns is door-free). The
// carve loop preserves doors via the `tiles[cur] === TILE_WALL` guard.
export const connectComponents: Pass = (level) => {
  const { W, H, tiles, cap } = cloneTiles(level.grid);

  // compIdx[i] = 0 for non-floor, 1..N for the component owning tile i.
  // Component labels are emitted in scanline order. `sizes[label - 1]` is
  // the size of component `label`. We only retain the (xs, ys) tile lists
  // for the *current* anchor candidate — swap-out when a larger component
  // is found. Order matters: the multi-source BFS below seeds in flood-fill
  // order, and the pinned hashes lock that exact traversal sequence.
  const compIdx = new Int32Array(cap);
  const sizes: number[] = [];
  let anchorLabel = 0;
  let anchorSize = 0;
  let anchorXs: number[] = [];
  let anchorYs: number[] = [];

  // Flood-fill scratch — fresh xs/ys per component (cheap: ~N short-lived
  // arrays per pass call, the JIT pools them well). Pre-allocating a single
  // shared `Int32Array(cap)` queue was tested earlier and lost to `number[]`
  // here because the average component is tiny relative to `cap`.
  for (let y = 0; y < H; y++) {
    const yBase = y * W;
    for (let x = 0; x < W; x++) {
      const i = yBase + x;
      if (compIdx[i] !== 0) continue;
      if (tiles[i] !== TILE_FLOOR) continue;

      const label = sizes.length + 1;
      compIdx[i] = label;
      const xs: number[] = [x];
      const ys: number[] = [y];
      let head = 0;
      while (head < xs.length) {
        const cx = xs[head];
        const cy = ys[head];
        head++;
        if (cx === undefined || cy === undefined) {
          throw new Error("connectComponents: unreachable flood queue read");
        }
        for (let k = 0; k < 4; k++) {
          const dx = DX4[k];
          const dy = DY4[k];
          if (dx === undefined || dy === undefined) {
            throw new Error("connectComponents: unreachable DX4/DY4 read");
          }
          const nx = cx + dx;
          const ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          const ni = ny * W + nx;
          if (compIdx[ni] !== 0) continue;
          if (tiles[ni] !== TILE_FLOOR) continue;
          compIdx[ni] = label;
          xs.push(nx);
          ys.push(ny);
        }
      }
      const size = xs.length;
      sizes.push(size);
      // Strict `>` ⇒ first-scanline component wins on size ties — matches the
      // previous descending stable-sort head exactly. Load-bearing: the
      // 100-seed hash pins in `tests/determinism.test.ts` lock the anchor.
      if (size > anchorSize) {
        anchorSize = size;
        anchorLabel = label;
        anchorXs = xs;
        anchorYs = ys;
      }
    }
  }

  if (sizes.length === 0) {
    throw new Error(
      "connectComponents: precondition violated — grid has zero floor tiles",
    );
  }
  if (sizes.length === 1) {
    return { ...level, grid: { ...level.grid, tiles } };
  }

  // Per-component merged flag; anchor starts merged.
  const mergedComp = new Uint8Array(sizes.length + 1);
  mergedComp[anchorLabel] = 1;
  let satellitesRemaining = sizes.length - 1;

  // BFS scratch — visited (1 byte/cell), parent (4 bytes/cell, self-parent
  // for anchor seeds), and a flat-queue of (x, y) Int32Array pairs.
  const visited = new Uint8Array(cap);
  const parent = new Int32Array(cap).fill(-1);
  const queueX = new Int32Array(cap);
  const queueY = new Int32Array(cap);
  let head = 0;
  let tail = 0;

  // Seed: every anchor floor tile is a source, parent = self (loop sentinel).
  // Iterate anchorXs/anchorYs (flood-fill order), not scanline — the BFS
  // wavefront geometry depends on this order, and so do the pinned hashes.
  for (let i = 0; i < anchorXs.length; i++) {
    const ax = anchorXs[i];
    const ay = anchorYs[i];
    if (ax === undefined || ay === undefined) {
      throw new Error("connectComponents: unreachable — anchor xs/ys mismatch");
    }
    const ai = ay * W + ax;
    visited[ai] = 1;
    parent[ai] = ai;
    queueX[tail] = ax;
    queueY[tail] = ay;
    tail++;
  }

  // Do not refactor to a `visit()` closure — measured ~14% slower (mutable
  // captures get boxed on the hot path).
  let done = false;
  while (head < tail && !done) {
    const cx = queueX[head];
    const cy = queueY[head];
    head++;
    if (cx === undefined || cy === undefined) {
      throw new Error("connectComponents: unreachable queue read");
    }
    const ci = cy * W + cx;
    for (let k = 0; k < 4; k++) {
      const dx = DX4[k];
      const dy = DY4[k];
      if (dx === undefined || dy === undefined) {
        throw new Error("connectComponents: unreachable DX4/DY4 read");
      }
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const ni = ny * W + nx;
      if (visited[ni] === 1) continue;
      visited[ni] = 1;
      parent[ni] = ci;
      queueX[tail] = nx;
      queueY[tail] = ny;
      tail++;

      const nci = compIdx[ni];
      if (
        nci !== undefined &&
        nci !== 0 &&
        nci !== anchorLabel &&
        mergedComp[nci] === 0
      ) {
        // First wave-arrival at a satellite. Walk parent[] back, carving any
        // wall on the path. Anchor seeds have parent[seed] === seed; the loop
        // terminates when we reach one.
        let cur = ni;
        while (parent[cur] !== cur) {
          if (tiles[cur] === TILE_WALL) {
            tiles[cur] = TILE_FLOOR;
          }
          const p = parent[cur];
          if (p === undefined || p < 0) {
            throw new Error(
              "connectComponents: unreachable — parent chain broke",
            );
          }
          cur = p;
        }
        mergedComp[nci] = 1;
        satellitesRemaining--;
        if (satellitesRemaining === 0) {
          done = true;
          break;
        }
      }
    }
  }

  // No defensive post-flood-fill: the algorithm is connected by construction.
  // When the wavefront first touches a satellite, the shortest 4-path from
  // anchor to that touched cell is carved via `parent[]`. Any other cell of
  // the same satellite is 4-connected to the touched cell (definition of the
  // flood-fill labelling), so it transitively connects to the anchor. The
  // 38-seed invariant sweep in `tests/invariants.test.ts` is the canary.
  return { ...level, grid: { ...level.grid, tiles } };
};
