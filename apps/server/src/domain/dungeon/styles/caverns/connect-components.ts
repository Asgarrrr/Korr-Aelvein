import { DX4, DY4, idx } from "../../grid";
import { type Pass, TILE_FLOOR, TILE_WALL } from "../../types";

type Component = {
  // Parallel arrays minimise per-tile allocation churn at flood time.
  readonly xs: number[];
  readonly ys: number[];
};

// Connect every floor component into a single 4-connected region.
//
// Multi-source BFS over the entire grid, seeded from every anchor (largest
// component) floor tile. Walls are passable; each tile is visited at most
// once, so total work is O(W·H). The first time the wave reaches a tile that
// belongs to a not-yet-merged satellite, we walk `parent[]` back to an anchor
// seed and carve every wall on that path to floor — the carved tunnel is, by
// construction, the shortest path (in 4-adjacency) from that satellite to the
// anchor.
//
// Assumes the input grid contains no TILE_DOOR: `labelComponents` treats any
// non-FLOOR tile as a partition, so doors would fragment regions. The carve
// loop itself preserves doors (see `tiles[cur] === TILE_WALL` guard below).
// Caverns is door-free by design; place this pass before any door-placing
// pass when composing other styles.
export const connectComponents: Pass = (level) => {
  const { width: W, height: H } = level.grid;
  const tiles = new Uint8Array(level.grid.tiles);
  const cap = W * H;

  const components = labelComponents(tiles, W, H);
  if (components.length === 0) {
    throw new Error(
      "connectComponents: precondition violated — grid has zero floor tiles",
    );
  }
  if (components.length === 1) {
    return { ...level, grid: { ...level.grid, tiles } };
  }

  // Largest component is the "anchor"; satellites merge into it.
  // Tie-break on size relies on JS stable sort (V8 7.0+, JSC, SpiderMonkey
  // all stable since 2019): equal-size components keep the scanline order
  // produced by `labelComponents`. This is load-bearing for determinism —
  // the 100-seed hash pins in `tests/determinism.test.ts` lock it in.
  const sorted = [...components].sort((a, b) => b.xs.length - a.xs.length);
  const anchor = sorted[0];
  if (anchor === undefined) {
    throw new Error("connectComponents: unreachable — sorted has no head");
  }

  // `compIdx[i]` = the component index (in `sorted`) that originally owned
  // tile i, or -1 if i was a wall. Walls carved by this pass keep compIdx=-1
  // — they don't need to be tagged as anchor because we only consult compIdx
  // when discovering a NEW satellite tile.
  const compIdx = new Int32Array(cap).fill(-1);
  for (let ci = 0; ci < sorted.length; ci++) {
    const comp = sorted[ci];
    if (comp === undefined) {
      throw new Error("connectComponents: unreachable — sorted[ci] missing");
    }
    for (let i = 0; i < comp.xs.length; i++) {
      const cx = comp.xs[i];
      const cy = comp.ys[i];
      if (cx === undefined || cy === undefined) {
        throw new Error("connectComponents: unreachable — comp xs/ys mismatch");
      }
      compIdx[idx(cx, cy, W)] = ci;
    }
  }

  // Per-component merged flag. anchor (index 0) starts merged; satellites
  // (1..n-1) flip to 1 when the wave first touches one of their tiles.
  const mergedComp = new Uint8Array(sorted.length);
  mergedComp[0] = 1;
  let satellitesRemaining = sorted.length - 1;

  // BFS scratch — visited (1 byte/cell), parent (4 bytes/cell, self-parent
  // for anchor seeds), and a flat-queue of (x, y) Int32Array pairs.
  const visited = new Uint8Array(cap);
  const parent = new Int32Array(cap).fill(-1);
  const queueX = new Int32Array(cap);
  const queueY = new Int32Array(cap);
  let head = 0;
  let tail = 0;

  // Seed: every anchor floor tile is a source, parent = self (loop sentinel).
  for (let i = 0; i < anchor.xs.length; i++) {
    const ax = anchor.xs[i];
    const ay = anchor.ys[i];
    if (ax === undefined || ay === undefined) {
      throw new Error("connectComponents: unreachable — anchor xs/ys mismatch");
    }
    const ai = idx(ax, ay, W);
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
      if (nci !== undefined && nci > 0 && mergedComp[nci] === 0) {
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

function labelComponents(
  tiles: Uint8Array,
  W: number,
  H: number,
): ReadonlyArray<Component> {
  const visited = new Uint8Array(W * H);
  const components: Component[] = [];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = idx(x, y, W);
      if (visited[i] === 1) continue;
      if (tiles[i] !== TILE_FLOOR) continue;
      components.push(flood(tiles, visited, W, H, x, y));
    }
  }
  return components;
}

function flood(
  tiles: Uint8Array,
  visited: Uint8Array,
  W: number,
  H: number,
  sx: number,
  sy: number,
): Component {
  const xs: number[] = [sx];
  const ys: number[] = [sy];
  visited[idx(sx, sy, W)] = 1;
  let head = 0;
  while (head < xs.length) {
    const cx = xs[head];
    const cy = ys[head];
    head++;
    if (cx === undefined || cy === undefined) {
      throw new Error("flood: unreachable queue read");
    }
    for (let k = 0; k < 4; k++) {
      const dx = DX4[k];
      const dy = DY4[k];
      if (dx === undefined || dy === undefined) {
        throw new Error("flood: unreachable DX4/DY4 read");
      }
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const ni = ny * W + nx;
      if (visited[ni] === 1) continue;
      if (tiles[ni] !== TILE_FLOOR) continue;
      visited[ni] = 1;
      xs.push(nx);
      ys.push(ny);
    }
  }
  return { xs, ys };
}
