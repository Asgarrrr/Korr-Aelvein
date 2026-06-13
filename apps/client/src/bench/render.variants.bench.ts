/**
 * Variant bench: candidate implementations of `renderGrid` measured
 * against the baseline. Run with `bun run bench:render:variants` from
 * `apps/client/`. Stable numbers: `bun run bench:render:agg` for the
 * baseline only; variants run single-pass here (re-run a few times if
 * adjacent variants tie within CV).
 *
 * Variants under test (output must be byte-equal to V0 — parity test
 * below):
 *   V0  baseline                 production: `row +=` + `Map<string, string>`
 *   V1  string-array-join        `chars[x] = ...; rows.push(chars.join(""))`
 *                                — avoids per-cell cons-string growth
 *   V2  flat-mob-index           Array<string|undefined>[y*w+x] instead
 *                                of Map<string,string> — avoids per-cell
 *                                template-string key alloc + Map.get
 *   V3  charcode-uint8           Uint8Array + TextDecoder.decode at end
 *                                — single buffer alloc, no intermediate
 *                                strings
 *   V4  V1 + V2                  string-array-join + flat mob index
 *   V5  V3 + V2                  charcode buffer + flat mob index
 */

import { renderGrid } from "../render";

// Local alias, not an `import { renderGrid as v0Render }`: import-rename is a
// banned form of `as` (CLAUDE.md). `v0Render` names the production renderer as
// the V0 baseline these variants are measured against.
const v0Render = renderGrid;

// ─── Shared input type (mirrors RenderInput) ────────────────────────────────

type Mob = { readonly x: number; readonly y: number; readonly glyph: string };
type Input = {
  readonly width: number;
  readonly height: number;
  readonly tiles: ReadonlyArray<number>;
  readonly player: { readonly x: number; readonly y: number };
  readonly mobs: ReadonlyArray<Mob>;
};

// ─── V1 — string-array per row, join at end ─────────────────────────────────

function v1Render(input: Input): string {
  const { width, height, tiles, player, mobs } = input;
  const mobByCell = new Map<string, string>();
  for (const m of mobs) mobByCell.set(`${m.x},${m.y}`, m.glyph);
  const rows: string[] = new Array(height);
  for (let y = 0; y < height; y++) {
    const chars: string[] = new Array(width);
    for (let x = 0; x < width; x++) {
      if (x === player.x && y === player.y) {
        chars[x] = "@";
        continue;
      }
      const mob = mobByCell.get(`${x},${y}`);
      if (mob !== undefined) {
        chars[x] = mob;
        continue;
      }
      const t = tiles[y * width + x] ?? 0;
      chars[x] = t === 1 ? "." : t === 2 ? "+" : "#";
    }
    rows[y] = chars.join("");
  }
  return rows.join("\n");
}

// ─── V2 — flat mob index (baseline string-builder otherwise) ────────────────

function v2Render(input: Input): string {
  const { width, height, tiles, player, mobs } = input;
  const mobByCell: Array<string | undefined> = new Array(width * height);
  for (const m of mobs) mobByCell[m.y * width + m.x] = m.glyph;
  const rows: string[] = [];
  for (let y = 0; y < height; y++) {
    let row = "";
    for (let x = 0; x < width; x++) {
      if (x === player.x && y === player.y) {
        row += "@";
        continue;
      }
      const idx = y * width + x;
      const mob = mobByCell[idx];
      if (mob !== undefined) {
        row += mob;
        continue;
      }
      const t = tiles[idx] ?? 0;
      row += t === 1 ? "." : t === 2 ? "+" : "#";
    }
    rows.push(row);
  }
  return rows.join("\n");
}

// ─── V3 — char-code Uint8Array + TextDecoder ────────────────────────────────

const CODE_WALL = 35; // '#'
const CODE_FLOOR = 46; // '.'
const CODE_DOOR = 43; // '+'
const CODE_PLAYER = 64; // '@'
const CODE_NL = 10; // '\n'

function v3Render(input: Input): string {
  const { width, height, tiles, player, mobs } = input;
  const mobByCell = new Map<string, string>();
  for (const m of mobs) mobByCell.set(`${m.x},${m.y}`, m.glyph);
  // width chars per row + 1 newline per row, minus the trailing newline.
  const buf = new Uint8Array(width * height + height - 1);
  let idx = 0;
  for (let y = 0; y < height; y++) {
    if (y > 0) {
      buf[idx] = CODE_NL;
      idx += 1;
    }
    for (let x = 0; x < width; x++) {
      let code: number;
      if (x === player.x && y === player.y) {
        code = CODE_PLAYER;
      } else {
        const mob = mobByCell.get(`${x},${y}`);
        if (mob !== undefined) {
          code = mob.charCodeAt(0) ?? CODE_WALL;
        } else {
          const t = tiles[y * width + x] ?? 0;
          code = t === 1 ? CODE_FLOOR : t === 2 ? CODE_DOOR : CODE_WALL;
        }
      }
      buf[idx] = code;
      idx += 1;
    }
  }
  return new TextDecoder().decode(buf);
}

// ─── V4 — V1 + V2 (string-array-join + flat mob index) ──────────────────────

function v4Render(input: Input): string {
  const { width, height, tiles, player, mobs } = input;
  const mobByCell: Array<string | undefined> = new Array(width * height);
  for (const m of mobs) mobByCell[m.y * width + m.x] = m.glyph;
  const rows: string[] = new Array(height);
  for (let y = 0; y < height; y++) {
    const chars: string[] = new Array(width);
    for (let x = 0; x < width; x++) {
      if (x === player.x && y === player.y) {
        chars[x] = "@";
        continue;
      }
      const idx = y * width + x;
      const mob = mobByCell[idx];
      if (mob !== undefined) {
        chars[x] = mob;
        continue;
      }
      const t = tiles[idx] ?? 0;
      chars[x] = t === 1 ? "." : t === 2 ? "+" : "#";
    }
    rows[y] = chars.join("");
  }
  return rows.join("\n");
}

// ─── V5 — V3 + V2 (charcode buffer + flat mob index) ────────────────────────

function v5Render(input: Input): string {
  const { width, height, tiles, player, mobs } = input;
  const mobByCell: Array<string | undefined> = new Array(width * height);
  for (const m of mobs) mobByCell[m.y * width + m.x] = m.glyph;
  const buf = new Uint8Array(width * height + height - 1);
  let idx = 0;
  for (let y = 0; y < height; y++) {
    if (y > 0) {
      buf[idx] = CODE_NL;
      idx += 1;
    }
    for (let x = 0; x < width; x++) {
      let code: number;
      if (x === player.x && y === player.y) {
        code = CODE_PLAYER;
      } else {
        const cellIdx = y * width + x;
        const mob = mobByCell[cellIdx];
        if (mob !== undefined) {
          code = mob.charCodeAt(0) ?? CODE_WALL;
        } else {
          const t = tiles[cellIdx] ?? 0;
          code = t === 1 ? CODE_FLOOR : t === 2 ? CODE_DOOR : CODE_WALL;
        }
      }
      buf[idx] = code;
      idx += 1;
    }
  }
  return new TextDecoder().decode(buf);
}

// ─── Variants table ─────────────────────────────────────────────────────────

type Variant = { readonly name: string; readonly fn: (i: Input) => string };

const VARIANTS: ReadonlyArray<Variant> = [
  { name: "V0 baseline", fn: v0Render },
  { name: "V1 string-array-join", fn: v1Render },
  { name: "V2 flat-mob-index", fn: v2Render },
  { name: "V3 charcode-uint8", fn: v3Render },
  { name: "V4 V1+V2 join+flat", fn: v4Render },
  { name: "V5 V3+V2 charcode+flat", fn: v5Render },
];

// ─── Fixtures (same shape as render.bench.ts) ───────────────────────────────

function buildLevel(
  width: number,
  height: number,
): { width: number; height: number; tiles: number[] } {
  const tiles: number[] = new Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const onEdge = x === 0 || y === 0 || x === width - 1 || y === height - 1;
      tiles[y * width + x] = onEdge ? 0 : 1;
    }
  }
  const midX = width >> 1;
  const midY = height >> 1;
  tiles[midY * width + 1] = 2;
  tiles[midY * width + (width - 2)] = 2;
  tiles[1 * width + midX] = 2;
  tiles[(height - 2) * width + midX] = 2;
  return { width, height, tiles };
}

function buildMobs(width: number, height: number, count: number): Mob[] {
  const mobs: Mob[] = [];
  const stride = 7;
  for (let i = 0; i < count; i++) {
    const idx = (i * stride) % ((width - 2) * (height - 2));
    const x = 1 + (idx % (width - 2));
    const y = 1 + Math.floor(idx / (width - 2));
    mobs.push({ x, y, glyph: "r" });
  }
  return mobs;
}

function makeInput(width: number, height: number, mobCount: number): Input {
  const lvl = buildLevel(width, height);
  return {
    width: lvl.width,
    height: lvl.height,
    tiles: lvl.tiles,
    player: { x: width >> 1, y: height >> 1 },
    mobs: buildMobs(width, height, mobCount),
  };
}

// ─── Bench harness ──────────────────────────────────────────────────────────

type Cell = { readonly variant: string; readonly nsPerOp: number };

function timeIt(iters: number, fn: () => void): number {
  const warmup = Math.min(Math.max(iters >> 4, 100), 5_000);
  for (let i = 0; i < warmup; i++) fn();
  const start = performance.now();
  for (let i = 0; i < iters; i++) fn();
  const elapsed = performance.now() - start;
  return (elapsed * 1_000_000) / iters;
}

type Scenario = {
  readonly name: string;
  readonly input: Input;
  readonly iters: number;
};

const SCENARIOS: ReadonlyArray<Scenario> = [
  {
    name: "S1 village 40×20, 1 mob",
    input: makeInput(40, 20, 1),
    iters: 100_000,
  },
  {
    name: "S2 donjon 80×30, 2 mobs",
    input: makeInput(80, 30, 2),
    iters: 50_000,
  },
  {
    name: "S3 donjon 80×30, 100 mobs",
    input: makeInput(80, 30, 100),
    iters: 30_000,
  },
  {
    name: "S4 large 200×100, 50 mobs",
    input: makeInput(200, 100, 50),
    iters: 3_000,
  },
  {
    name: "S5 max 300×150, 100 mobs",
    input: makeInput(300, 150, 100),
    iters: 1_000,
  },
];

// ─── Parity check: every variant must produce the same string as V0 ─────────

function parityCheck(): void {
  for (const sc of SCENARIOS) {
    const expected = v0Render(sc.input);
    for (const v of VARIANTS) {
      const got = v.fn(sc.input);
      if (got !== expected) {
        const expectedSnippet = `${expected.slice(0, 80)}…`;
        const gotSnippet = `${got.slice(0, 80)}…`;
        throw new Error(
          `parity: ${v.name} on ${sc.name} diverges from V0\n  expected: ${expectedSnippet}\n  got:      ${gotSnippet}`,
        );
      }
    }
  }
}

// ─── Run ────────────────────────────────────────────────────────────────────

function runAll(): readonly Cell[][] {
  const rows: Cell[][] = [];
  for (const sc of SCENARIOS) {
    const cells: Cell[] = [];
    for (const v of VARIANTS) {
      const ns = timeIt(sc.iters, () => {
        v.fn(sc.input);
      });
      cells.push({ variant: v.name, nsPerOp: ns });
    }
    rows.push(cells);
  }
  return rows;
}

function format(
  scenarios: readonly Scenario[],
  rows: readonly Cell[][],
): string {
  const lines: string[] = [];
  const header = [
    "scenario".padEnd(28),
    ...VARIANTS.map((v) => v.name.padStart(22)),
  ].join("");
  lines.push(header);
  lines.push("─".repeat(header.length));
  for (let i = 0; i < scenarios.length; i++) {
    const sc = scenarios[i];
    const cells = rows[i];
    if (sc === undefined || cells === undefined) continue;
    const baseCell = cells.find((c) => c.variant === VARIANTS[0]?.name);
    const baseNs = baseCell?.nsPerOp ?? null;
    const row = [sc.name.padEnd(28)];
    for (const v of VARIANTS) {
      const cell = cells.find((c) => c.variant === v.name);
      if (cell === undefined) {
        row.push("-".padStart(22));
        continue;
      }
      const nsStr = cell.nsPerOp.toFixed(0);
      if (baseNs === null || cell.variant === VARIANTS[0]?.name) {
        row.push(nsStr.padStart(22));
      } else {
        const ratio = ((cell.nsPerOp / baseNs - 1) * 100).toFixed(0);
        const sign = ratio.startsWith("-") ? "" : "+";
        row.push(`${nsStr} (${sign}${ratio}%)`.padStart(22));
      }
    }
    lines.push(row.join(""));
  }
  return lines.join("\n");
}

if (import.meta.main) {
  console.log("\nRenderer variants bench — 6 variants × 5 scenarios\n");
  parityCheck();
  console.log("  parity OK — every variant matches V0 byte-equal");
  console.log();
  const rows = runAll();
  console.log(format(SCENARIOS, rows));
  console.log();
}

export type { Input };
export { v0Render, v1Render, v2Render, v3Render, v4Render, v5Render };
