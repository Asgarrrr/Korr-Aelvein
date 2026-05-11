// End-to-end tests for the CAVERNS style and a pinned regression signature.
// Mirrors the structure of dungeon.test.ts / rim-invariants.test.ts so future
// drift in the cellular-automata pipeline is caught immediately.

import { describe, expect, test } from "bun:test";
import { createRng } from "../../../../rng/index";
import { idx, inBounds } from "../../../grid";
import {
  generateLevel,
  type Level,
  TILE_DOOR,
  TILE_FLOOR,
  TILE_WALL,
} from "../../../index";

function tileCounts(tiles: Uint8Array) {
  let walls = 0;
  let floors = 0;
  let doors = 0;
  for (const t of tiles) {
    if (t === TILE_WALL) walls++;
    else if (t === TILE_FLOOR) floors++;
    else if (t === TILE_DOOR) doors++;
  }
  return { walls, floors, doors };
}

function reachableFloorsFromSpawn(level: Level): Set<number> {
  const { width: W, height: H, tiles } = level.grid;
  const reached = new Set<number>();
  if (level.spawn === null) return reached;
  const [sx, sy] = level.spawn;
  if (!inBounds(sx, sy, level.grid)) return reached;
  const startIdx = idx(sx, sy, W);
  if (tiles[startIdx] !== TILE_FLOOR) return reached;
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
      if (tiles[ni] !== TILE_FLOOR) continue;
      reached.add(ni);
      qx.push(nx);
      qy.push(ny);
    }
  }
  return reached;
}

describe("generateLevel (caverns)", () => {
  test("produces a level with spawn, downStairs, no rooms, and no doors", () => {
    const lvl = generateLevel(createRng(1), 80, 30, "caverns");
    expect(lvl.spawn).not.toBeNull();
    expect(lvl.downStairs).not.toBeNull();
    expect(lvl.rooms).toEqual([]);
    const { doors } = tileCounts(lvl.grid.tiles);
    expect(doors).toBe(0);
  });

  test("the grid contains both TILE_WALL and TILE_FLOOR", () => {
    const lvl = generateLevel(createRng(2), 80, 30, "caverns");
    const { walls, floors } = tileCounts(lvl.grid.tiles);
    expect(walls).toBeGreaterThan(0);
    expect(floors).toBeGreaterThan(0);
  });

  test("border tiles are all TILE_WALL (cave is enclosed)", () => {
    const lvl = generateLevel(createRng(3), 80, 30, "caverns");
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

  test("BFS from spawn reaches every floor tile (4-adjacent)", () => {
    const lvl = generateLevel(createRng(4), 80, 30, "caverns");
    const reached = reachableFloorsFromSpawn(lvl);
    const { tiles } = lvl.grid;
    for (let i = 0; i < tiles.length; i++) {
      if (tiles[i] === TILE_FLOOR) {
        expect(reached.has(i)).toBe(true);
      }
    }
  });

  test("spawn and downStairs are on floor and different from each other", () => {
    const lvl = generateLevel(createRng(5), 80, 30, "caverns");
    if (lvl.spawn === null || lvl.downStairs === null) {
      throw new Error("unreachable");
    }
    const [sx, sy] = lvl.spawn;
    const [dx, dy] = lvl.downStairs;
    expect(lvl.grid.tiles[idx(sx, sy, lvl.grid.width)]).toBe(TILE_FLOOR);
    expect(lvl.grid.tiles[idx(dx, dy, lvl.grid.width)]).toBe(TILE_FLOOR);
    expect(sx === dx && sy === dy).toBe(false);
  });

  test("regression pin: seed=42, 80x30, caverns", () => {
    // Snapshot of the algorithm's output for a known seed. If this fails an
    // algorithmic regression has slipped in — either accept the new signature
    // on purpose (and update the values) or fix the regression. Do NOT loosen
    // the assertions to make this pass.
    const lvl = generateLevel(createRng(42), 80, 30, "caverns");
    const { walls, floors, doors } = tileCounts(lvl.grid.tiles);
    expect(floors).toBe(1289);
    expect(walls).toBe(1111);
    expect(doors).toBe(0);
    expect(lvl.rooms.length).toBe(0);
    expect(lvl.spawn).toEqual([73, 11]);
    expect(lvl.downStairs).toEqual([3, 18]);
  });
});
