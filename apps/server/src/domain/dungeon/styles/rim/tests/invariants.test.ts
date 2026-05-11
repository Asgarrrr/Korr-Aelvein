// Adversarial Phase 1 — structural invariants for the rim style.
//
// Strategy: for every seed in a 30+ entry pool (mix of hand-picked and
// rng-derived), generate an 80x30 rim level and assert every invariant.
// Failures must report the seed so the run is reproducible.

import { describe, expect, test } from "bun:test";
import { createRng } from "../../../../rng/index";
import { idx, inBounds } from "../../../grid";
import {
  generateLevel,
  type Level,
  type Room,
  TILE_DOOR,
  TILE_FLOOR,
} from "../../../index";

const HAND_PICKED_SEEDS: ReadonlyArray<number> = [
  0, 1, 2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37, 42, 100, 256, 1024,
  0xc0ffee, 0xbadf00d, 0xdeadbeef, 0xfeedface, 0xcafebabe,
];

function buildSeedPool(): ReadonlyArray<number> {
  // Add a stream of rng-derived seeds for breadth. Total >= 30.
  const breadthRng = createRng(0xabad1dea);
  const extras: number[] = [];
  for (let i = 0; i < 15; i++) extras.push(breadthRng.int(0, 2 ** 30));
  return [...HAND_PICKED_SEEDS, ...extras];
}

const SEEDS = buildSeedPool();

function floodFill(
  level: Level,
  start: readonly [number, number],
): Set<number> {
  const { width: W, height: H, tiles } = level.grid;
  const visited = new Set<number>();
  const startIdx = idx(start[0], start[1], W);
  if (
    !inBounds(start[0], start[1], level.grid) ||
    (tiles[startIdx] !== TILE_FLOOR && tiles[startIdx] !== TILE_DOOR)
  ) {
    return visited;
  }
  visited.add(startIdx);
  const queue: Array<readonly [number, number]> = [start];
  while (queue.length > 0) {
    const head = queue.shift();
    if (head === undefined) throw new Error("flood: queue invariant");
    const [x, y] = head;
    const ns: ReadonlyArray<readonly [number, number]> = [
      [x, y - 1],
      [x + 1, y],
      [x, y + 1],
      [x - 1, y],
    ];
    for (const [nx, ny] of ns) {
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const i = idx(nx, ny, W);
      if (visited.has(i)) continue;
      const t = tiles[i];
      if (t !== TILE_FLOOR && t !== TILE_DOOR) continue;
      visited.add(i);
      queue.push([nx, ny]);
    }
  }
  return visited;
}

function inRoomFloor(r: Room, x: number, y: number): boolean {
  return x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;
}

function rectsOverlap(a: Room, b: Room, expand: number): boolean {
  const aL = a.x - expand;
  const aR = a.x + a.w + expand;
  const aT = a.y - expand;
  const aB = a.y + a.h + expand;
  const bL = b.x;
  const bR = b.x + b.w;
  const bT = b.y;
  const bB = b.y + b.h;
  return aL < bR && bL < aR && aT < bB && bT < aB;
}

function isOnPerimeter(r: Room, x: number, y: number): boolean {
  // Perimeter = the 1-cell border around the floor rectangle (not including
  // the floor itself, not including the corners that would lie on the
  // diagonal). A door tile is always orthogonal to a floor cell, so it lives
  // on one of: (x == r.x-1 or x == r.x+r.w) with y in [r.y, r.y+r.h),
  // OR (y == r.y-1 or y == r.y+r.h) with x in [r.x, r.x+r.w).
  const inXSpan = x >= r.x && x < r.x + r.w;
  const inYSpan = y >= r.y && y < r.y + r.h;
  const onNRow = y === r.y - 1 && inXSpan;
  const onSRow = y === r.y + r.h && inXSpan;
  const onWCol = x === r.x - 1 && inYSpan;
  const onECol = x === r.x + r.w && inYSpan;
  return onNRow || onSRow || onWCol || onECol;
}

describe("rim invariants — many seeds", () => {
  test(`runs for ${SEEDS.length} seeds with 80x30 rim`, () => {
    expect(SEEDS.length).toBeGreaterThanOrEqual(30);
  });

  for (const seed of SEEDS) {
    describe(`seed ${seed}`, () => {
      const lvl = generateLevel(createRng(seed), 80, 30, "rim");

      test("spawn and downStairs are set", () => {
        expect(lvl.spawn).not.toBeNull();
        expect(lvl.downStairs).not.toBeNull();
      });

      test("connectivity from spawn reaches every FLOOR and DOOR tile", () => {
        if (lvl.spawn === null) throw new Error(`seed ${seed}: spawn null`);
        const reached = floodFill(lvl, lvl.spawn);
        const { tiles } = lvl.grid;
        for (let i = 0; i < tiles.length; i++) {
          const t = tiles[i];
          if (t === TILE_FLOOR || t === TILE_DOOR) {
            expect(reached.has(i)).toBe(true);
          }
        }
      });

      test("downStairs is reachable from spawn and on a FLOOR tile", () => {
        if (lvl.spawn === null || lvl.downStairs === null) {
          throw new Error(`seed ${seed}: spawn/downStairs null`);
        }
        const reached = floodFill(lvl, lvl.spawn);
        const [dx, dy] = lvl.downStairs;
        const dIdx = idx(dx, dy, lvl.grid.width);
        expect(lvl.grid.tiles[dIdx]).toBe(TILE_FLOOR);
        expect(reached.has(dIdx)).toBe(true);
      });

      test("no two rooms' floor rectangles overlap (strict)", () => {
        for (let i = 0; i < lvl.rooms.length; i++) {
          for (let j = i + 1; j < lvl.rooms.length; j++) {
            const a = lvl.rooms[i];
            const b = lvl.rooms[j];
            if (a === undefined || b === undefined) {
              throw new Error("unreachable");
            }
            expect(rectsOverlap(a, b, 0)).toBe(false);
          }
        }
      });

      test("rooms expanded by 1 cell never overlap (no shared walls)", () => {
        // Stronger invariant: rooms should be separated by at least one wall
        // OR connected only by a door. The accretion overlap check uses a
        // 1-cell perimeter precisely to enforce this. The loop pass only
        // promotes walls to doors, never carves them away — so this holds
        // post-loop too.
        for (let i = 0; i < lvl.rooms.length; i++) {
          for (let j = i + 1; j < lvl.rooms.length; j++) {
            const a = lvl.rooms[i];
            const b = lvl.rooms[j];
            if (a === undefined || b === undefined) {
              throw new Error("unreachable");
            }
            expect(rectsOverlap(a, b, 1)).toBe(false);
          }
        }
      });

      test("every room is fully in-bounds", () => {
        for (const r of lvl.rooms) {
          expect(r.x).toBeGreaterThanOrEqual(0);
          expect(r.y).toBeGreaterThanOrEqual(0);
          expect(r.x + r.w).toBeLessThanOrEqual(lvl.grid.width);
          expect(r.y + r.h).toBeLessThanOrEqual(lvl.grid.height);
        }
      });

      test("every cell inside a room's floor rectangle is TILE_FLOOR", () => {
        for (const r of lvl.rooms) {
          for (let yy = r.y; yy < r.y + r.h; yy++) {
            for (let xx = r.x; xx < r.x + r.w; xx++) {
              const t = lvl.grid.tiles[idx(xx, yy, lvl.grid.width)];
              expect(t).toBe(TILE_FLOOR);
            }
          }
        }
      });

      test("every Room.doors entry is at a perimeter cell and a TILE_DOOR", () => {
        for (const r of lvl.rooms) {
          for (const [dx, dy] of r.doors) {
            expect(isOnPerimeter(r, dx, dy)).toBe(true);
            const t = lvl.grid.tiles[idx(dx, dy, lvl.grid.width)];
            expect(t).toBe(TILE_DOOR);
          }
        }
      });

      test("every door tile is mirrored on two rooms OR on zero (loop)", () => {
        // For each TILE_DOOR cell on the grid, count how many room.doors
        // lists reference it. Allowed: 0 (loop) or >= 2 (accretion). 1 would
        // be a bug — orphan registration.
        const { tiles, width: W, height: H } = lvl.grid;
        for (let y = 0; y < H; y++) {
          for (let x = 0; x < W; x++) {
            if (tiles[idx(x, y, W)] !== TILE_DOOR) continue;
            let refs = 0;
            for (const r of lvl.rooms) {
              for (const [dx, dy] of r.doors) {
                if (dx === x && dy === y) refs++;
              }
            }
            // 1 would mean "registered on one room only" — never legitimate.
            expect(refs === 0 || refs >= 2).toBe(true);
          }
        }
      });

      test("spawn is on a floor tile inside rooms[0]", () => {
        if (lvl.spawn === null) throw new Error("unreachable");
        const [sx, sy] = lvl.spawn;
        const t = lvl.grid.tiles[idx(sx, sy, lvl.grid.width)];
        expect(t).toBe(TILE_FLOOR);
        const r0 = lvl.rooms[0];
        if (r0 === undefined) throw new Error("unreachable");
        expect(inRoomFloor(r0, sx, sy)).toBe(true);
      });

      test("downStairs is on a floor tile inside SOME room", () => {
        if (lvl.downStairs === null) throw new Error("unreachable");
        const [dx, dy] = lvl.downStairs;
        const t = lvl.grid.tiles[idx(dx, dy, lvl.grid.width)];
        expect(t).toBe(TILE_FLOOR);
        let inside = false;
        for (const r of lvl.rooms) {
          if (inRoomFloor(r, dx, dy)) {
            inside = true;
            break;
          }
        }
        expect(inside).toBe(true);
      });

      test("spawn !== downStairs", () => {
        if (lvl.spawn === null || lvl.downStairs === null) {
          throw new Error("unreachable");
        }
        const same =
          lvl.spawn[0] === lvl.downStairs[0] &&
          lvl.spawn[1] === lvl.downStairs[1];
        expect(same).toBe(false);
      });
    });
  }
});
