/**
 * Bench for `renderGrid` (`../render.ts`) — the snapshot→ASCII conversion
 * the client runs once per WS frame, inside the React state setter.
 * Reports per-call time + output byte count at five grid/mob scales.
 *
 * Used as a regression check: re-run before merging any change to
 * `render.ts` or the snapshot consumer in `Game.tsx`. The companion
 * `render.variants.bench.ts` measured 6 candidate implementations and
 * recorded the comparison + rejected patterns; production runs the
 * winner (V5: flat mob index + Uint8Array charcode buffer).
 *
 * Post-V5 reference numbers (2026-05, JSC):
 *
 *   scenario                          ns/op    output (B)
 *   S1 village 40×20, 1 mob            1 300        819
 *   S2 donjon 80×30, 2 mobs            3 240      2 429
 *   S3 donjon 80×30, 100 mobs          3 820      2 429
 *   S4 large 200×100, 50 mobs         22 180     20 099
 *   S5 max 300×150, 100 mobs          48 880     45 149
 *
 * Each scenario is 15–25 × faster than the pre-V5 baseline (e.g. S2: 65 µs
 * → 3 µs, S5: 1.22 ms → 49 µs). See `render.variants.bench.ts` for the
 * variant-by-variant breakdown that justified V5 over V1 (string-array
 * join alone), V3 (charcode alone), and the rejected V4 (V1+V2).
 *
 * Caveats:
 *   - Bun runs this, NOT a browser. Real-world client performance includes
 *     React + DOM diff + paint, which Bun can't measure. This bench only
 *     covers the pure-JS conversion.
 *   - V8 ≈ JSC ≠ identical. Bun uses JavaScriptCore; browsers run V8 (or
 *     SpiderMonkey). The per-op cost will be ballpark-correct but a 30 %
 *     gap between engines is normal.
 */

import { type RenderInput, renderGrid } from "../render";

// ─── Harness ──────────────────────────────────────────────────────────────────

type Result = {
  readonly scenario: string;
  readonly iters: number;
  readonly nsPerOp: number;
  readonly outputBytes: number;
};

function bench(scenario: string, iters: number, input: RenderInput): Result {
  const warmup = Math.min(Math.max(iters >> 4, 100), 5_000);
  for (let i = 0; i < warmup; i++) renderGrid(input);

  const start = performance.now();
  for (let i = 0; i < iters; i++) renderGrid(input);
  const elapsed = performance.now() - start;

  const nsPerOp = (elapsed * 1_000_000) / iters;
  const outputBytes = renderGrid(input).length;

  return { scenario, iters, nsPerOp, outputBytes };
}

function formatTable(rows: readonly Result[]): string {
  const header =
    "scenario                                    iters       ns/op   output (B)";
  const sep =
    "──────────────────────────────────────────────────────────────────────────";
  const lines = rows.map((r) => {
    const sc = r.scenario.padEnd(42);
    const it = r.iters.toLocaleString().padStart(10);
    const ns = r.nsPerOp.toFixed(1).padStart(12);
    const bytes = r.outputBytes.toLocaleString().padStart(12);
    return `${sc}${it}${ns}${bytes}`;
  });
  return [header, sep, ...lines].join("\n");
}

// ─── Fixtures ────────────────────────────────────────────────────────────────

// Build a synthetic level: outer wall, inner floor, sprinkled doors at the
// 8 cardinal-midpoint cells. Same shape any rim-style level approximates.
function buildLevel(
  width: number,
  height: number,
): { width: number; height: number; tiles: number[] } {
  const tiles: number[] = new Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const onEdge = x === 0 || y === 0 || x === width - 1 || y === height - 1;
      tiles[y * width + x] = onEdge ? 0 : 1; // 0 wall, 1 floor
    }
  }
  // Sprinkle a few doors so the door branch in renderGrid sees traffic.
  const midX = width >> 1;
  const midY = height >> 1;
  tiles[midY * width + 1] = 2;
  tiles[midY * width + (width - 2)] = 2;
  tiles[1 * width + midX] = 2;
  tiles[(height - 2) * width + midX] = 2;
  return { width, height, tiles };
}

function buildMobs(
  width: number,
  height: number,
  count: number,
): ReadonlyArray<{ x: number; y: number; glyph: string }> {
  const mobs: { x: number; y: number; glyph: string }[] = [];
  // Walk a coprime stride so mob positions don't cluster on one row.
  const stride = 7;
  for (let i = 0; i < count; i++) {
    const idx = (i * stride) % ((width - 2) * (height - 2));
    const x = 1 + (idx % (width - 2));
    const y = 1 + Math.floor(idx / (width - 2));
    mobs.push({ x, y, glyph: "r" });
  }
  return mobs;
}

function makeInput(
  width: number,
  height: number,
  mobCount: number,
): RenderInput {
  const lvl = buildLevel(width, height);
  return {
    width: lvl.width,
    height: lvl.height,
    tiles: lvl.tiles,
    player: { x: width >> 1, y: height >> 1 },
    mobs: buildMobs(width, height, mobCount),
  };
}

// ─── Scenarios ───────────────────────────────────────────────────────────────

function runAll(): readonly Result[] {
  const rows: Result[] = [];

  // S1 — village zone: 40×20, 1 mob (the shopkeeper). The smallest realistic case.
  rows.push(bench("S1 village 40×20, 1 mob", 100_000, makeInput(40, 20, 1)));

  // S2 — donjon (current): 80×30, 2 mobs.
  rows.push(bench("S2 donjon 80×30, 2 mobs", 50_000, makeInput(80, 30, 2)));

  // S3 — donjon stressed: 80×30, 100 mobs. Tests the Map alloc + lookup cost.
  rows.push(bench("S3 donjon 80×30, 100 mobs", 30_000, makeInput(80, 30, 100)));

  // S4 — large procgen: 200×100, 50 mobs. Rim's medium reference.
  rows.push(bench("S4 large 200×100, 50 mobs", 5_000, makeInput(200, 100, 50)));

  // S5 — max procgen: 300×150, 100 mobs. Rim's stated reference max.
  rows.push(bench("S5 max 300×150, 100 mobs", 2_000, makeInput(300, 150, 100)));

  return rows;
}

// ─── Entry ────────────────────────────────────────────────────────────────────

if (import.meta.main) {
  console.log("\nClient renderer bench — discovery (renderGrid pure JS)\n");
  const results = runAll();
  console.log(formatTable(results));
  console.log();
  console.log(
    "Regression check: production runs V5 (flat mob index + Uint8Array\n" +
      "charcode buffer). S2 (donjon realistic) should sit ~3 µs and S5 (max\n" +
      "grid) ~50 µs. 2× drift here is a real concern; see render.variants.bench\n" +
      "for the variant comparison that justified V5.",
  );
  console.log();
}

export type { Result };
export { runAll };
