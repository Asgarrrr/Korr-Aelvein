import { cloneTiles, DX4, DY4 } from "../../grid";
import { type Pass, TILE_FLOOR, TILE_WALL } from "../../types";

// Connect every floor component into a single 4-connected region. Pass 1
// flood-fills + labels components in scanline order, picking the largest as
// anchor (strict `>` resolves ties to the first scanline-encountered one —
// load-bearing for cross-runs determinism). Pass 2 is a multi-source BFS
// from every anchor tile over the WHOLE grid (walls passable); the first
// wave-arrival at a satellite carves a shortest 4-path through walls via
// `parent[]`, by construction the shortest distance from that satellite to
// the anchor.
//
// Assumes the input grid is door-free. The carve loop preserves any doors
// it crosses via the `tiles[cur] === TILE_WALL` guard.
export const connectComponents: Pass = (level) => {
  const { W, H, tiles, cap } = cloneTiles(level.grid);

  // We only retain the (xs, ys) tile lists for the CURRENT anchor candidate
  // — swap-out when a larger component is found. The BFS in pass 2 must
  // seed from these tiles in flood-fill order (not scanline) to keep the
  // wavefront geometry deterministic.
  const compIdx = new Int32Array(cap);
  const sizes: number[] = [];
  let anchorLabel = 0;
  let anchorSize = 0;
  let anchorXs: number[] = [];
  let anchorYs: number[] = [];

  // A pre-allocated shared Int32Array queue was benched and lost to per-call
  // `number[]` here — average component is tiny relative to `cap`.
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
      // Strict `>` ⇒ first-scanline component wins on size ties. Load-bearing
      // for cross-runs determinism (the anchor choice cascades into the BFS
      // wavefront geometry).
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

  const mergedComp = new Uint8Array(sizes.length + 1);
  mergedComp[anchorLabel] = 1;
  let satellitesRemaining = sizes.length - 1;

  const visited = new Uint8Array(cap);
  const parent = new Int32Array(cap).fill(-1);
  const queueX = new Int32Array(cap);
  const queueY = new Int32Array(cap);
  let head = 0;
  let tail = 0;

  // Anchor seeds have `parent[seed] === seed` — the carve loop's terminator.
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

  return { ...level, grid: { ...level.grid, tiles } };
};
