// Print a generated dungeon to the terminal as colored ASCII.
//
// Usage:
//   bun run preview                                     (defaults: rim, seed 42, 80x30)
//   bun run preview --style caverns --seed 7
//   bun run preview -s rim -w 120 -h 60 --no-color
//
// Glyphs (Brogue / NetHack convention):
//   #  wall          dim grey
//   .  floor         white
//   +  door          yellow
//   @  spawn         bright green   (overlays floor)
//   >  down-stairs   bright cyan    (overlays floor)

import {
  generateLevel,
  type Level,
  TILE_DOOR,
  TILE_FLOOR,
  TILE_WALL,
} from "../src/domain/dungeon/index";
import { createRng } from "../src/domain/rng/index";

type StyleId = "rim" | "caverns";

type Opts = {
  readonly style: StyleId;
  readonly seed: number;
  readonly width: number;
  readonly height: number;
  readonly color: boolean;
};

const USAGE = `\
Usage:
  bun run preview [options]

Options:
  -s, --style <rim|caverns>    Pipeline to run (default: rim)
      --seed <int>             Seed for createRng (default: 42)
  -w, --width <int>            Grid width (default: 80)
  -h, --height <int>           Grid height (default: 30)
      --no-color               Disable ANSI colors
      --help                   Show this help
`;

function isStyleId(v: string): v is StyleId {
  return v === "rim" || v === "caverns";
}

function parseIntArg(name: string, raw: string | undefined): number {
  if (raw === undefined) throw new Error(`${name} requires a value`);
  const n = Number(raw);
  if (!Number.isInteger(n)) {
    throw new Error(`${name} must be an integer (got "${raw}")`);
  }
  return n;
}

function parsePosInt(name: string, raw: string | undefined): number {
  const n = parseIntArg(name, raw);
  if (n <= 0) throw new Error(`${name} must be a positive integer (got ${n})`);
  return n;
}

function parseArgs(argv: ReadonlyArray<string>): Opts {
  let style: StyleId = "rim";
  let seed = 42;
  let width = 80;
  let height = 30;
  // Auto-disable color when piped (e.g. `bun run preview | less`).
  let color = process.stdout.isTTY === true;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === undefined) continue;
    if (arg === "--help") {
      process.stdout.write(USAGE);
      process.exit(0);
    } else if (arg === "--no-color") {
      color = false;
    } else if (arg === "-s" || arg === "--style") {
      const v = argv[i + 1];
      if (v === undefined || !isStyleId(v)) {
        throw new Error(`--style must be 'rim' or 'caverns' (got "${v}")`);
      }
      style = v;
      i++;
    } else if (arg === "--seed") {
      seed = parseIntArg("--seed", argv[i + 1]);
      i++;
    } else if (arg === "-w" || arg === "--width") {
      width = parsePosInt("--width", argv[i + 1]);
      i++;
    } else if (arg === "-h" || arg === "--height") {
      height = parsePosInt("--height", argv[i + 1]);
      i++;
    } else {
      throw new Error(`unknown arg: ${arg} (try --help)`);
    }
  }
  return { style, seed, width, height, color };
}

// ANSI escape helpers. SGR codes:
//   90 = bright black (grey)   33 = yellow
//   37 = white                 92 = bright green     96 = bright cyan
function paint(s: string, sgr: string, enabled: boolean): string {
  return enabled ? `\x1b[${sgr}m${s}\x1b[0m` : s;
}

function render(level: Level, color: boolean): string {
  const { width: W, height: H, tiles } = level.grid;
  const spawnIdx =
    level.spawn === null ? -1 : level.spawn[1] * W + level.spawn[0];
  const stairsIdx =
    level.downStairs === null
      ? -1
      : level.downStairs[1] * W + level.downStairs[0];

  const lines: string[] = [];
  for (let y = 0; y < H; y++) {
    let row = "";
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (i === spawnIdx) {
        row += paint("@", "92", color);
      } else if (i === stairsIdx) {
        row += paint(">", "96", color);
      } else {
        const t = tiles[i];
        if (t === TILE_WALL) row += paint("#", "90", color);
        else if (t === TILE_FLOOR) row += paint(".", "37", color);
        else if (t === TILE_DOOR) row += paint("+", "33", color);
        else row += "?"; // unreachable for the current Tile union
      }
    }
    lines.push(row);
  }
  return lines.join("\n");
}

function summary(level: Level, opts: Opts, elapsedMs: number): string {
  let walls = 0;
  let floors = 0;
  let doors = 0;
  for (const t of level.grid.tiles) {
    if (t === TILE_WALL) walls++;
    else if (t === TILE_FLOOR) floors++;
    else if (t === TILE_DOOR) doors++;
  }
  const spawn =
    level.spawn === null ? "—" : `(${level.spawn[0]},${level.spawn[1]})`;
  const stairs =
    level.downStairs === null
      ? "—"
      : `(${level.downStairs[0]},${level.downStairs[1]})`;
  return [
    `style=${opts.style}  seed=${opts.seed}  size=${opts.width}x${opts.height}  gen=${elapsedMs.toFixed(2)}ms`,
    `rooms=${level.rooms.length}  floor=${floors}  doors=${doors}  walls=${walls}  spawn=${spawn}  stairs=${stairs}`,
  ].join("\n");
}

function main(): void {
  const opts = parseArgs(process.argv.slice(2));
  const rng = createRng(opts.seed);
  const t0 = performance.now();
  const level = generateLevel(rng, opts.width, opts.height, opts.style);
  const elapsed = performance.now() - t0;
  process.stdout.write(summary(level, opts, elapsed));
  process.stdout.write("\n\n");
  process.stdout.write(render(level, opts.color));
  process.stdout.write("\n");
}

main();
