// Adversarial Phase 2 — structural invariants for the caverns style.
//
// For each seed in a 30+ pool (hand-picked + rng-derived), generate an 80x30
// caverns level and hammer every structural invariant the pipeline promises.
// Failures must report the seed so each run is reproducible.

import { describe, expect, test } from "bun:test";
import { createRng } from "../../../../rng/index";
import { idx } from "../../../grid";
import {
  emptyLevel,
  generateLevel,
  type Level,
  runPipeline,
  TILE_DOOR,
  TILE_FLOOR,
  TILE_WALL,
} from "../../../index";
import { connectComponents } from "../connect-components";
import { iterateCA } from "../iterate-ca";
import { seedCA } from "../seed-ca";

const HAND_PICKED_SEEDS: ReadonlyArray<number> = [
  0, 1, 2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37, 42, 100, 256, 1024,
  0xc0ffee, 0xbadf00d, 0xdeadbeef, 0xfeedface, 0xcafebabe,
];

function buildSeedPool(): ReadonlyArray<number> {
  // Derived seeds from a fixed master rng → deterministic but broader coverage.
  const breadthRng = createRng(0xc4f3c4f3);
  const extras: number[] = [];
  for (let i = 0; i < 15; i++) extras.push(breadthRng.int(0, 2 ** 30));
  return [...HAND_PICKED_SEEDS, ...extras];
}

const SEEDS = buildSeedPool();

function reachableFromSpawn(level: Level): Set<number> {
  // 4-BFS over FLOOR ∪ DOOR. Caverns currently have no doors, but writing the
  // BFS generically keeps the invariant correct if doors are ever added.
  const { width: W, height: H, tiles } = level.grid;
  const reached = new Set<number>();
  if (level.spawn === null) return reached;
  const [sx, sy] = level.spawn;
  const startIdx = idx(sx, sy, W);
  if (tiles[startIdx] !== TILE_FLOOR && tiles[startIdx] !== TILE_DOOR) {
    return reached;
  }
  reached.add(startIdx);
  const qx: number[] = [sx];
  const qy: number[] = [sy];
  let head = 0;
  while (head < qx.length) {
    const cx = qx[head];
    const cy = qy[head];
    head++;
    if (cx === undefined || cy === undefined) throw new Error("unreachable");
    const ns: ReadonlyArray<readonly [number, number]> = [
      [cx, cy - 1],
      [cx + 1, cy],
      [cx, cy + 1],
      [cx - 1, cy],
    ];
    for (const [nx, ny] of ns) {
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const ni = idx(nx, ny, W);
      if (reached.has(ni)) continue;
      const t = tiles[ni];
      if (t !== TILE_FLOOR && t !== TILE_DOOR) continue;
      reached.add(ni);
      qx.push(nx);
      qy.push(ny);
    }
  }
  return reached;
}

function tileCounts(tiles: Uint8Array) {
  let walls = 0;
  let floors = 0;
  let doors = 0;
  let other = 0;
  for (const t of tiles) {
    if (t === TILE_WALL) walls++;
    else if (t === TILE_FLOOR) floors++;
    else if (t === TILE_DOOR) doors++;
    else other++;
  }
  return { walls, floors, doors, other };
}

describe("caverns invariants — many seeds", () => {
  test(`pool has >= 30 seeds`, () => {
    expect(SEEDS.length).toBeGreaterThanOrEqual(30);
  });

  for (const seed of SEEDS) {
    describe(`seed ${seed}`, () => {
      const lvl = generateLevel(createRng(seed), 80, 30, "caverns");

      test("rooms is empty", () => {
        expect(lvl.rooms).toEqual([]);
      });

      test("no TILE_DOOR anywhere on the grid", () => {
        const { doors } = tileCounts(lvl.grid.tiles);
        expect(doors).toBe(0);
      });

      test("border is all WALL", () => {
        const { width: W, height: H, tiles } = lvl.grid;
        for (let x = 0; x < W; x++) {
          expect(tiles[idx(x, 0, W)]).toBe(TILE_WALL);
          expect(tiles[idx(x, H - 1, W)]).toBe(TILE_WALL);
        }
        for (let y = 0; y < H; y++) {
          expect(tiles[idx(0, y, W)]).toBe(TILE_WALL);
          expect(tiles[idx(W - 1, y, W)]).toBe(TILE_WALL);
        }
      });

      test("floor + wall = W*H (no orphan tile values)", () => {
        const { walls, floors, doors, other } = tileCounts(lvl.grid.tiles);
        expect(other).toBe(0);
        expect(doors).toBe(0);
        expect(walls + floors).toBe(80 * 30);
      });

      test("both wall and floor present (no degenerate pure-wall/pure-floor level)", () => {
        const { walls, floors } = tileCounts(lvl.grid.tiles);
        expect(walls).toBeGreaterThan(0);
        expect(floors).toBeGreaterThan(0);
      });

      test("spawn is on a floor tile", () => {
        if (lvl.spawn === null) throw new Error(`seed ${seed}: spawn null`);
        const [sx, sy] = lvl.spawn;
        expect(lvl.grid.tiles[idx(sx, sy, lvl.grid.width)]).toBe(TILE_FLOOR);
      });

      test("downStairs is on a floor tile", () => {
        if (lvl.downStairs === null) {
          throw new Error(`seed ${seed}: downStairs null`);
        }
        const [dx, dy] = lvl.downStairs;
        expect(lvl.grid.tiles[idx(dx, dy, lvl.grid.width)]).toBe(TILE_FLOOR);
      });

      test("spawn !== downStairs", () => {
        if (lvl.spawn === null || lvl.downStairs === null) {
          throw new Error(`seed ${seed}: spawn/downStairs null`);
        }
        const same =
          lvl.spawn[0] === lvl.downStairs[0] &&
          lvl.spawn[1] === lvl.downStairs[1];
        expect(same).toBe(false);
      });

      test("single connected component: BFS from spawn reaches every FLOOR/DOOR", () => {
        const reached = reachableFromSpawn(lvl);
        const { tiles } = lvl.grid;
        for (let i = 0; i < tiles.length; i++) {
          const t = tiles[i];
          if (t === TILE_FLOOR || t === TILE_DOOR) {
            expect(reached.has(i)).toBe(true);
          }
        }
      });

      test("downStairs is reachable from spawn", () => {
        if (lvl.downStairs === null) throw new Error("unreachable");
        const reached = reachableFromSpawn(lvl);
        const [dx, dy] = lvl.downStairs;
        expect(reached.has(idx(dx, dy, lvl.grid.width))).toBe(true);
      });
    });
  }
});

describe("connectComponents writes FLOOR only (no doors introduced)", () => {
  test("on a CA-shaped grid, doors before == doors after == 0", () => {
    const beforeConnect = runPipeline(emptyLevel(80, 30), createRng(42), [
      seedCA({ wallProbability: 0.45 }),
      iterateCA({ iterations: 5, birthLimit: 5, survivalLimit: 4 }),
    ]);
    const before = tileCounts(beforeConnect.grid.tiles);
    expect(before.doors).toBe(0);
    const after = connectComponents(beforeConnect, createRng(0));
    const afterCounts = tileCounts(after.grid.tiles);
    expect(afterCounts.doors).toBe(0);
    // Floors can only grow (walls → floors).
    expect(afterCounts.floors).toBeGreaterThanOrEqual(before.floors);
    expect(afterCounts.walls).toBeLessThanOrEqual(before.walls);
  });

  test("a DOOR on the unique shortest carve-path survives the parent-walk", () => {
    // Two FLOOR patches separated by a 1-tile-wide wall barrier whose middle
    // cell is a DOOR. The shortest 4-path between the patches is the row-1
    // corridor through that DOOR, so the BFS parent-chain will visit it. The
    // carve loop's `tiles[cur] === TILE_WALL` guard MUST skip the DOOR — if it
    // ever regresses to an unconditional `tiles[cur] = TILE_FLOOR`, this test
    // catches it.
    //
    // Layout (10 × 3, walls implicit):
    //   row 0: # # # # # # # # # #
    //   row 1: # . . # + # . . . #
    //   row 2: # # # # # # # # # #
    //
    //   Patch A (satellite, 2 cells): cols 1..2
    //   Wall barrier: col 3, col 5
    //   DOOR: (4, 1)
    //   Patch B (anchor, larger, 3 cells): cols 6..8
    const base = emptyLevel(10, 3);
    const tiles = new Uint8Array(base.grid.tiles);
    tiles[idx(1, 1, 10)] = TILE_FLOOR;
    tiles[idx(2, 1, 10)] = TILE_FLOOR;
    tiles[idx(4, 1, 10)] = TILE_DOOR;
    tiles[idx(6, 1, 10)] = TILE_FLOOR;
    tiles[idx(7, 1, 10)] = TILE_FLOOR;
    tiles[idx(8, 1, 10)] = TILE_FLOOR;
    const lvl: Level = { ...base, grid: { ...base.grid, tiles } };
    const out = connectComponents(lvl, createRng(0));
    // DOOR preserved despite sitting on the carve path.
    expect(out.grid.tiles[idx(4, 1, 10)]).toBe(TILE_DOOR);
    // Surrounding walls (3,1) and (5,1) were carved — proving the parent-walk
    // actually traversed the DOOR cell (and didn't trivially short-circuit).
    expect(out.grid.tiles[idx(3, 1, 10)]).toBe(TILE_FLOOR);
    expect(out.grid.tiles[idx(5, 1, 10)]).toBe(TILE_FLOOR);
  });
});
