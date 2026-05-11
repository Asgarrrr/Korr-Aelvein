// Algorithmic correctness for the CA-specific passes in isolation.
//
// The point of this file is to hit the algorithmic guts directly (not via
// `generateLevel`): convergence of `iterateCA`, distribution sanity of
// `seedCA`, BFS verification of `connectComponents` on hand-built grids,
// and 4-adjacency of the carved Bresenham tunnels.

import { describe, expect, test } from "bun:test";
import { createRng } from "../../../../rng/index";
import { idx } from "../../../grid";
import { emptyLevel, type Level, TILE_FLOOR, TILE_WALL } from "../../../index";
import { connectComponents } from "../connect-components";
import { iterateCA } from "../iterate-ca";
import { seedCA } from "../seed-ca";

function countComponents(level: Level): number {
  const { width: W, height: H, tiles } = level.grid;
  const visited = new Uint8Array(W * H);
  let n = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = idx(x, y, W);
      if (visited[i] === 1) continue;
      if (tiles[i] !== TILE_FLOOR) continue;
      n++;
      const qx: number[] = [x];
      const qy: number[] = [y];
      visited[i] = 1;
      let head = 0;
      while (head < qx.length) {
        const cx = qx[head];
        const cy = qy[head];
        head++;
        if (cx === undefined || cy === undefined) throw new Error("unreach");
        const ns: ReadonlyArray<readonly [number, number]> = [
          [cx, cy - 1],
          [cx + 1, cy],
          [cx, cy + 1],
          [cx - 1, cy],
        ];
        for (const [nx, ny] of ns) {
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          const ni = idx(nx, ny, W);
          if (visited[ni] === 1) continue;
          if (tiles[ni] !== TILE_FLOOR) continue;
          visited[ni] = 1;
          qx.push(nx);
          qy.push(ny);
        }
      }
    }
  }
  return n;
}

function makeAllWall(w: number, h: number): Level {
  const base = emptyLevel(w, h);
  const tiles = new Uint8Array(base.grid.tiles);
  for (let i = 0; i < tiles.length; i++) tiles[i] = TILE_WALL;
  return { ...base, grid: { ...base.grid, tiles } };
}

function fillRect(
  lvl: Level,
  x0: number,
  y0: number,
  w: number,
  h: number,
  tile: 0 | 1 | 2,
): Level {
  const W = lvl.grid.width;
  const tiles = new Uint8Array(lvl.grid.tiles);
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) {
      tiles[idx(x, y, W)] = tile;
    }
  }
  return { ...lvl, grid: { ...lvl.grid, tiles } };
}

describe("seedCA — standalone", () => {
  test("wallProbability=0: interior all FLOOR, border all WALL", () => {
    const out = seedCA({ wallProbability: 0 })(
      emptyLevel(30, 20),
      createRng(1),
    );
    const { width: W, height: H, tiles } = out.grid;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const isBorder = x === 0 || y === 0 || x === W - 1 || y === H - 1;
        const t = tiles[idx(x, y, W)];
        if (isBorder) expect(t).toBe(TILE_WALL);
        else expect(t).toBe(TILE_FLOOR);
      }
    }
  });

  test("wallProbability=1: everything WALL", () => {
    const out = seedCA({ wallProbability: 1 })(
      emptyLevel(30, 20),
      createRng(2),
    );
    for (const t of out.grid.tiles) expect(t).toBe(TILE_WALL);
  });

  test("distribution sanity: 200x200 @ p=0.5, interior ~50% walls ±5%", () => {
    // Border is always WALL so we only sample the interior. With ~200*200 ≈
    // 40k interior cells the Chebyshev bound on the empirical proportion is
    // tight enough that ±5% is comfortably outside random noise.
    const out = seedCA({ wallProbability: 0.5 })(
      emptyLevel(200, 200),
      createRng(0xa55),
    );
    const { width: W, height: H, tiles } = out.grid;
    let interiorWalls = 0;
    let interiorCount = 0;
    for (let y = 1; y < H - 1; y++) {
      for (let x = 1; x < W - 1; x++) {
        interiorCount++;
        if (tiles[idx(x, y, W)] === TILE_WALL) interiorWalls++;
      }
    }
    const ratio = interiorWalls / interiorCount;
    expect(ratio).toBeGreaterThan(0.45);
    expect(ratio).toBeLessThan(0.55);
  });
});

describe("iterateCA — algorithmic properties", () => {
  test("iterations=0 is identity on bytes", () => {
    const seeded = seedCA({ wallProbability: 0.45 })(
      emptyLevel(40, 30),
      createRng(1),
    );
    const out = iterateCA({ iterations: 0 })(seeded, createRng(99));
    expect(Array.from(out.grid.tiles)).toEqual(Array.from(seeded.grid.tiles));
  });

  test("deterministic regardless of rng (no rng consumption, two runs equal)", () => {
    const seeded = seedCA({ wallProbability: 0.45 })(
      emptyLevel(40, 30),
      createRng(2),
    );
    const a = iterateCA({ iterations: 5 })(seeded, createRng(0));
    const b = iterateCA({ iterations: 5 })(seeded, createRng(0xffff));
    expect(Array.from(a.grid.tiles)).toEqual(Array.from(b.grid.tiles));
  });

  test("convergence: after 50 iterations + 1 more, the diff is small/zero", () => {
    const seeded = seedCA({ wallProbability: 0.45 })(
      emptyLevel(60, 40),
      createRng(3),
    );
    const after50 = iterateCA({ iterations: 50 })(seeded, createRng(0));
    const after51 = iterateCA({ iterations: 1 })(after50, createRng(0));
    let diff = 0;
    for (let i = 0; i < after50.grid.tiles.length; i++) {
      if (after50.grid.tiles[i] !== after51.grid.tiles[i]) diff++;
    }
    // Cave CA with default rules typically converges in ~5–7 iterations; the
    // 50 → 51 step should be a fixed point. Allow ≤ 5 cells of slop in case
    // of a 2-cycle oscillator in a narrow corridor.
    expect(diff).toBeLessThanOrEqual(5);
  });

  test("border invariant: after any iteration count, border is all WALL", () => {
    for (const iters of [0, 1, 2, 5, 13]) {
      const seeded = seedCA({ wallProbability: 0.45 })(
        emptyLevel(30, 18),
        createRng(iters + 100),
      );
      const out = iterateCA({ iterations: iters })(seeded, createRng(0));
      const { width: W, height: H, tiles } = out.grid;
      for (let x = 0; x < W; x++) {
        expect(tiles[idx(x, 0, W)]).toBe(TILE_WALL);
        expect(tiles[idx(x, H - 1, W)]).toBe(TILE_WALL);
      }
      for (let y = 0; y < H; y++) {
        expect(tiles[idx(0, y, W)]).toBe(TILE_WALL);
        expect(tiles[idx(W - 1, y, W)]).toBe(TILE_WALL);
      }
    }
  });
});

describe("connectComponents — hand-built grids", () => {
  test("3 disconnected floor patches → 1 component after carve", () => {
    // Three rectangles in three corners of a 30x20 grid, fully surrounded by
    // walls. Verifies the multi-satellite merging path.
    let lvl: Level = makeAllWall(30, 20);
    lvl = fillRect(lvl, 2, 2, 3, 3, TILE_FLOOR); // top-left
    lvl = fillRect(lvl, 24, 2, 4, 3, TILE_FLOOR); // top-right
    lvl = fillRect(lvl, 13, 14, 3, 3, TILE_FLOOR); // bottom-center
    expect(countComponents(lvl)).toBe(3);
    const out = connectComponents(lvl, createRng(0));
    expect(countComponents(out)).toBe(1);
  });

  test("all-wall grid → throws", () => {
    const lvl = makeAllWall(15, 10);
    expect(() => connectComponents(lvl, createRng(0))).toThrow();
  });

  test("single-component grid → byte-identical output (no-op)", () => {
    let lvl: Level = makeAllWall(20, 12);
    lvl = fillRect(lvl, 5, 4, 6, 4, TILE_FLOOR); // single rectangle, fully connected
    expect(countComponents(lvl)).toBe(1);
    const before = new Uint8Array(lvl.grid.tiles);
    const out = connectComponents(lvl, createRng(0));
    expect(Array.from(out.grid.tiles)).toEqual(Array.from(before));
  });

  test("carved tunnel is 4-connected: every adjacent pair of carved tiles is orthogonally adjacent", () => {
    // Steep diagonal: a 1-cell patch at (2,2) and another at (28,7). The
    // Bresenham line between them has a steep horizontal slope (dx=26, dy=5),
    // so the 4-adjacency fix has to insert orthogonal intermediates whenever
    // both x and y advance in the same step.
    let lvl: Level = makeAllWall(32, 12);
    lvl = fillRect(lvl, 2, 2, 1, 1, TILE_FLOOR);
    lvl = fillRect(lvl, 28, 7, 1, 1, TILE_FLOOR);
    const out = connectComponents(lvl, createRng(0));
    expect(countComponents(out)).toBe(1);

    // Reconstruct the connected floor set by 4-BFS from (2,2). If every floor
    // tile is in that BFS, the tunnel is 4-connected end-to-end.
    const { width: W, height: H, tiles } = out.grid;
    const visited = new Uint8Array(W * H);
    visited[idx(2, 2, W)] = 1;
    const qx: number[] = [2];
    const qy: number[] = [2];
    let head = 0;
    while (head < qx.length) {
      const cx = qx[head];
      const cy = qy[head];
      head++;
      if (cx === undefined || cy === undefined) throw new Error("unreach");
      const ns: ReadonlyArray<readonly [number, number]> = [
        [cx, cy - 1],
        [cx + 1, cy],
        [cx, cy + 1],
        [cx - 1, cy],
      ];
      for (const [nx, ny] of ns) {
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const ni = idx(nx, ny, W);
        if (visited[ni] === 1) continue;
        if (tiles[ni] !== TILE_FLOOR) continue;
        visited[ni] = 1;
        qx.push(nx);
        qy.push(ny);
      }
    }
    // The far endpoint must be reachable via 4-adjacency.
    expect(visited[idx(28, 7, W)]).toBe(1);
  });

  test("vertical-only line: carved tunnel is one column of FLOOR", () => {
    let lvl: Level = makeAllWall(10, 20);
    lvl = fillRect(lvl, 5, 2, 1, 1, TILE_FLOOR);
    lvl = fillRect(lvl, 5, 17, 1, 1, TILE_FLOOR);
    const out = connectComponents(lvl, createRng(0));
    expect(countComponents(out)).toBe(1);
    // every tile in the column x=5 between y=2 and y=17 should be FLOOR.
    for (let y = 2; y <= 17; y++) {
      expect(out.grid.tiles[idx(5, y, 10)]).toBe(TILE_FLOOR);
    }
  });

  test("horizontal-only line: carved tunnel is one row of FLOOR", () => {
    let lvl: Level = makeAllWall(30, 10);
    lvl = fillRect(lvl, 3, 5, 1, 1, TILE_FLOOR);
    lvl = fillRect(lvl, 25, 5, 1, 1, TILE_FLOOR);
    const out = connectComponents(lvl, createRng(0));
    expect(countComponents(out)).toBe(1);
    for (let x = 3; x <= 25; x++) {
      expect(out.grid.tiles[idx(x, 5, 30)]).toBe(TILE_FLOOR);
    }
  });

  test("equal x/y delta (perfect diagonal): tunnel is 4-connected", () => {
    // dx = dy = 10. The Bresenham step alternates pure-diagonal moves; the
    // 4-adjacency fix must insert an orthogonal cell on every such step.
    let lvl: Level = makeAllWall(20, 20);
    lvl = fillRect(lvl, 4, 4, 1, 1, TILE_FLOOR);
    lvl = fillRect(lvl, 14, 14, 1, 1, TILE_FLOOR);
    const out = connectComponents(lvl, createRng(0));
    expect(countComponents(out)).toBe(1);
  });
});
