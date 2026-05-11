// Demo: constraint-as-pass. Builds a custom rim-style pipeline where a fixed
// 7x7 "shrine" room is *guaranteed* to exist at the geometric center, and the
// rest of the level (accretion + loops + stairs) grows around it. Same seed →
// same shrine room, same dungeon. No retries, no rejection sampling.
//
// Usage:
//   bun run preview-shrine                     (seed 42, 80x30)
//   bun run preview-shrine 7                   (seed 7)
//   bun run preview-shrine 42 100 50           (seed 42, custom size)

import {
  emptyLevel,
  type Level,
  type Pass,
  type Pipeline,
  type Room,
  runPipeline,
  TILE_DOOR,
  TILE_FLOOR,
  TILE_WALL,
} from "../src/domain/dungeon/index";
import {
  accreteRooms,
  addLoops,
  placeStairs,
} from "../src/domain/dungeon/styles/rim/index";
import { createRng } from "../src/domain/rng/index";

// ─── The constraint primitive ────────────────────────────────────────────────
//
// `placeFixedRoom` is the building block for "this level MUST contain X".
// It replaces `placeFirstRoom` in a pipeline — same shape (carve floor + set
// spawn) but at a fixed position with fixed dimensions. Subsequent passes
// (accretion, loops) see it as an existing room and never touch its tiles.
//
// To stack multiple required rooms (e.g. shrine + treasury + boss), call this
// multiple times in a row with different specs — each one appends to
// `level.rooms` so accretion can grow off any of them.
function placeFixedRoom(spec: {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}): Pass {
  return (level) => {
    const { width: W, height: H } = level.grid;
    if (spec.x < 1 || spec.y < 1) {
      throw new Error(
        `placeFixedRoom: room top-left (${spec.x},${spec.y}) must be ≥ 1 (border reserved)`,
      );
    }
    if (spec.x + spec.w > W - 1 || spec.y + spec.h > H - 1) {
      throw new Error(
        `placeFixedRoom: room (${spec.x},${spec.y} +${spec.w}x${spec.h}) does not fit in grid ${W}x${H}`,
      );
    }
    const tiles = new Uint8Array(level.grid.tiles);
    for (let yy = spec.y; yy < spec.y + spec.h; yy++) {
      for (let xx = spec.x; xx < spec.x + spec.w; xx++) {
        tiles[yy * W + xx] = TILE_FLOOR;
      }
    }
    const room: Room = {
      x: spec.x,
      y: spec.y,
      w: spec.w,
      h: spec.h,
      doors: [],
    };
    const cx = spec.x + Math.floor(spec.w / 2);
    const cy = spec.y + Math.floor(spec.h / 2);
    // First-room-only behaviour: this *is* the first room. Spawn lands inside
    // it. To keep spawn elsewhere, swap `placeFixedRoom` with a different pass
    // and run `placeFixedRoom` after `placeFirstRoom`.
    return {
      ...level,
      grid: { ...level.grid, tiles },
      rooms: [...level.rooms, room],
      spawn: level.spawn === null ? [cx, cy] : level.spawn,
    };
  };
}

// ─── The constrained pipeline ────────────────────────────────────────────────

const seed = Number(process.argv[2] ?? 42);
const w = Number(process.argv[3] ?? 80);
const h = Number(process.argv[4] ?? 30);

const shrineW = 7;
const shrineH = 7;
const shrineX = Math.floor((w - shrineW) / 2);
const shrineY = Math.floor((h - shrineH) / 2);

const SHRINE: Pipeline = [
  placeFixedRoom({ x: shrineX, y: shrineY, w: shrineW, h: shrineH }),
  accreteRooms({ maxAttempts: 400, maxRooms: 25, minSize: 4, maxSize: 8 }),
  addLoops({ maxAttempts: 200, maxLoops: 15, minPathDistance: 5 }),
  placeStairs,
];

const rng = createRng(seed);
const t0 = performance.now();
const level = runPipeline(emptyLevel(w, h), rng, SHRINE);
const elapsed = performance.now() - t0;

// ─── Render ──────────────────────────────────────────────────────────────────

function paint(s: string, sgr: string, on: boolean): string {
  return on ? `\x1b[${sgr}m${s}\x1b[0m` : s;
}

function render(lvl: Level, color: boolean): string {
  const { width: W, height: H, tiles } = lvl.grid;
  const spawnIdx = lvl.spawn === null ? -1 : lvl.spawn[1] * W + lvl.spawn[0];
  const stairsIdx =
    lvl.downStairs === null ? -1 : lvl.downStairs[1] * W + lvl.downStairs[0];
  // Highlight the shrine perimeter with magenta '*' to visually verify the
  // constraint held. (The shrine *floor* shows as '.', same as any other room.)
  const inShrine = (x: number, y: number): boolean =>
    x >= shrineX &&
    x < shrineX + shrineW &&
    y >= shrineY &&
    y < shrineY + shrineH;

  const lines: string[] = [];
  for (let y = 0; y < H; y++) {
    let row = "";
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (i === spawnIdx) row += paint("@", "92", color);
      else if (i === stairsIdx) row += paint(">", "96", color);
      else if (inShrine(x, y)) row += paint("*", "95", color);
      else {
        const t = tiles[i];
        if (t === TILE_WALL) row += paint("#", "90", color);
        else if (t === TILE_FLOOR) row += paint(".", "37", color);
        else if (t === TILE_DOOR) row += paint("+", "33", color);
        else row += "?";
      }
    }
    lines.push(row);
  }
  return lines.join("\n");
}

const color = process.stdout.isTTY === true;

process.stdout.write(
  `pipeline=SHRINE  seed=${seed}  size=${w}x${h}  gen=${elapsed.toFixed(2)}ms\n`,
);
process.stdout.write(
  `shrine=(${shrineX},${shrineY}) ${shrineW}x${shrineH}  rooms=${level.rooms.length}  spawn=${level.spawn === null ? "—" : `(${level.spawn[0]},${level.spawn[1]})`}  stairs=${level.downStairs === null ? "—" : `(${level.downStairs[0]},${level.downStairs[1]})`}\n`,
);
process.stdout.write(
  `\nLegend: * shrine floor   @ spawn   > stairs   + door\n\n`,
);
process.stdout.write(render(level, color));
process.stdout.write("\n");
