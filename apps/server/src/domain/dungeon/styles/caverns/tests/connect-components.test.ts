import { describe, expect, test } from "bun:test";
import { createRng } from "../../../../rng/index";
import { idx } from "../../../grid";
import { emptyLevel, runPipeline } from "../../../index";
import { type Level, TILE_FLOOR, TILE_WALL } from "../../../types";
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
        if (cx === undefined || cy === undefined) {
          throw new Error("unreachable");
        }
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

function buildCAGrid(seed: number, w = 80, h = 30) {
  return runPipeline(emptyLevel(w, h), createRng(seed), [
    seedCA({ wallProbability: 0.45 }),
    iterateCA({ iterations: 5, birthLimit: 5, survivalLimit: 4 }),
  ]);
}

describe("connectComponents", () => {
  test("does not consume rng (carving is deterministic given state)", () => {
    const lvl = buildCAGrid(13);
    const rng = createRng(456);
    connectComponents(lvl, rng);
    const ref = createRng(456);
    expect(rng.next()).toBe(ref.next());
  });

  test("preserves rooms / spawn / downStairs", () => {
    const lvl = buildCAGrid(11);
    const out = connectComponents(lvl, createRng(0));
    expect(out.rooms).toEqual([]);
    expect(out.spawn).toBeNull();
    expect(out.downStairs).toBeNull();
  });

  test("throws when the grid has zero floor tiles", () => {
    const lvl = seedCA({ wallProbability: 1 })(
      emptyLevel(20, 12),
      createRng(1),
    );
    expect(() => connectComponents(lvl, createRng(0))).toThrow();
  });

  test("single floor tile: trivially one component, returns unchanged tiles", () => {
    // Construct a grid where only one interior cell is floor.
    const base = emptyLevel(10, 10);
    const tiles = new Uint8Array(base.grid.tiles);
    for (let i = 0; i < tiles.length; i++) tiles[i] = TILE_WALL;
    tiles[idx(5, 5, base.grid.width)] = TILE_FLOOR;
    const lvl: Level = { ...base, grid: { ...base.grid, tiles } };
    const out = connectComponents(lvl, createRng(0));
    expect(countComponents(out)).toBe(1);
    expect(Array.from(out.grid.tiles)).toEqual(Array.from(tiles));
  });

  test("determinism: same input grid → same carved output", () => {
    const a = connectComponents(buildCAGrid(99), createRng(0));
    const b = connectComponents(buildCAGrid(99), createRng(0));
    expect(Array.from(a.grid.tiles)).toEqual(Array.from(b.grid.tiles));
  });

  test("does not mutate the input level tiles", () => {
    const lvl = buildCAGrid(31);
    const before = new Uint8Array(lvl.grid.tiles);
    connectComponents(lvl, createRng(0));
    for (let i = 0; i < before.length; i++) {
      expect(lvl.grid.tiles[i]).toBe(before[i] ?? -1);
    }
  });
});
