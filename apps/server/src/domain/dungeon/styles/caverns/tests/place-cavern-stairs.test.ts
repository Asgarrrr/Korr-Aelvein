import { describe, expect, test } from "bun:test";
import { createRng } from "../../../../rng/index";
import { idx } from "../../../grid";
import { emptyLevel, runPipeline } from "../../../index";
import { type Level, TILE_FLOOR } from "../../../types";
import { connectComponents } from "../connect-components";
import { iterateCA } from "../iterate-ca";
import { placeCavernSpawn } from "../place-cavern-spawn";
import { placeCavernStairs } from "../place-cavern-stairs";
import { seedCA } from "../seed-ca";

function buildWithSpawn(seed: number, w = 80, h = 30): Level {
  return runPipeline(emptyLevel(w, h), createRng(seed), [
    seedCA({ wallProbability: 0.45 }),
    iterateCA({ iterations: 5, birthLimit: 5, survivalLimit: 4 }),
    connectComponents,
    placeCavernSpawn,
  ]);
}

describe("placeCavernStairs", () => {
  test("sets downStairs to a floor tile reachable from spawn", () => {
    const base = buildWithSpawn(1);
    const out = placeCavernStairs(base, createRng(0));
    expect(out.downStairs).not.toBeNull();
    if (out.downStairs === null) throw new Error("unreachable");
    const [dx, dy] = out.downStairs;
    expect(out.grid.tiles[idx(dx, dy, out.grid.width)]).toBe(TILE_FLOOR);
  });

  test("downStairs is the farthest floor tile (BFS distance) from spawn", () => {
    const base = buildWithSpawn(2);
    const out = placeCavernStairs(base, createRng(0));
    if (out.spawn === null || out.downStairs === null) {
      throw new Error("unreachable");
    }
    const [sx, sy] = out.spawn;
    const [dx, dy] = out.downStairs;

    // Recompute BFS distance map from spawn; downStairs must achieve the max.
    const { width: W, height: H, tiles } = out.grid;
    const dist = new Int32Array(W * H);
    for (let i = 0; i < dist.length; i++) dist[i] = -1;
    dist[idx(sx, sy, W)] = 0;
    const qx: number[] = [sx];
    const qy: number[] = [sy];
    let head = 0;
    let maxD = 0;
    while (head < qx.length) {
      const cx = qx[head];
      const cy = qy[head];
      head++;
      if (cx === undefined || cy === undefined) throw new Error("unreachable");
      const cd = dist[idx(cx, cy, W)] ?? -1;
      if (cd > maxD) maxD = cd;
      const ns: ReadonlyArray<readonly [number, number]> = [
        [cx, cy - 1],
        [cx + 1, cy],
        [cx, cy + 1],
        [cx - 1, cy],
      ];
      for (const [nx, ny] of ns) {
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const ni = idx(nx, ny, W);
        if (dist[ni] !== -1) continue;
        const t = tiles[ni];
        if (t !== TILE_FLOOR) continue;
        dist[ni] = cd + 1;
        qx.push(nx);
        qy.push(ny);
      }
    }
    expect(dist[idx(dx, dy, W)]).toBe(maxD);
  });

  test("downStairs differs from spawn on a non-trivial cave", () => {
    const base = buildWithSpawn(3);
    const out = placeCavernStairs(base, createRng(0));
    if (out.spawn === null || out.downStairs === null) {
      throw new Error("unreachable");
    }
    const same =
      out.spawn[0] === out.downStairs[0] && out.spawn[1] === out.downStairs[1];
    expect(same).toBe(false);
  });

  test("does not modify tiles, rooms, or spawn", () => {
    const base = buildWithSpawn(4);
    const beforeTiles = new Uint8Array(base.grid.tiles);
    const out = placeCavernStairs(base, createRng(0));
    expect(Array.from(out.grid.tiles)).toEqual(Array.from(beforeTiles));
    expect(out.rooms).toEqual([]);
    expect(out.spawn).toEqual(base.spawn);
  });

  test("does not consume rng", () => {
    const base = buildWithSpawn(5);
    const rng = createRng(789);
    placeCavernStairs(base, rng);
    const ref = createRng(789);
    expect(rng.next()).toBe(ref.next());
  });

  test("throws if spawn is null (precondition)", () => {
    const base = emptyLevel(20, 12);
    expect(() => placeCavernStairs(base, createRng(0))).toThrow();
  });

  test("throws on a degenerate single-tile spawn (no reachable floor)", () => {
    // Manually built: spawn on a floor tile completely enclosed by walls.
    const lvl = emptyLevel(10, 10);
    const tiles = new Uint8Array(lvl.grid.tiles);
    // all walls already (0 is TILE_WALL); set a single floor at (5,5).
    tiles[idx(5, 5, lvl.grid.width)] = TILE_FLOOR;
    const withSpawn: Level = {
      ...lvl,
      grid: { ...lvl.grid, tiles },
      spawn: [5, 5],
    };
    expect(() => placeCavernStairs(withSpawn, createRng(0))).toThrow();
  });

  test("determinism: same input → same downStairs", () => {
    const base = buildWithSpawn(6);
    const a = placeCavernStairs(base, createRng(0));
    const b = placeCavernStairs(base, createRng(0));
    expect(a.downStairs).toEqual(b.downStairs);
  });
});
