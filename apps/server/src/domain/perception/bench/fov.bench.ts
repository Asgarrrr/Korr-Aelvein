/**
 * Discovery bench for `computeFov` — runs once per accepted player MOVE
 * (Phase 7), so the budget question is "does one call fit comfortably
 * inside a tick?". Scenarios cover both styles at the shipping grid size
 * (80×30) and the shipping radius (12), plus a radius sweep on rim to
 * expose the O(radius²) scan growth.
 *
 * Run: `bun run bench:fov` from `apps/server/`.
 *
 * ── Discovery results (2026-06, Bun 1.3, M-series) ────────────────────────
 *
 *   scenario                                ns/op
 *   rim 80×30, r=12                        ~2 800
 *   rim 80×30, r=8                         ~2 500
 *   rim 80×30, r=16                        ~2 500
 *   caverns 80×30, r=12                    ~4 600
 *
 *   ~3-5 µs per call at shipping scale, an order of magnitude below
 *   `toSnapshot` (~21 µs). The radius sweep is flat on rim because the
 *   spawn room's walls terminate the scan well before the radius does;
 *   open caverns cost ~2× for the same reason. No optimisation warranted;
 *   re-run if the radius grows past ~20 or FOV starts running per-mob
 *   (pursuit AI).
 */

import { generateLevel, type StyleId } from "../../dungeon/index";
import { createRng } from "../../rng/index";
import { computeFov } from "../index";

type Result = {
  readonly scenario: string;
  readonly iters: number;
  readonly nsPerOp: number;
};

function bench(scenario: string, iters: number, run: () => Uint8Array): Result {
  for (let i = 0; i < 2_000; i++) run();
  const start = performance.now();
  for (let i = 0; i < iters; i++) run();
  const elapsed = performance.now() - start;
  return { scenario, iters, nsPerOp: (elapsed * 1_000_000) / iters };
}

function scenario(style: StyleId, radius: number): () => Uint8Array {
  const level = generateLevel(createRng(42), 80, 30, style);
  if (level.spawn === null) {
    throw new Error(`bench: ${style} seed 42 has no spawn`);
  }
  const [ox, oy] = level.spawn;
  return () => computeFov(level, ox, oy, radius);
}

if (import.meta.main) {
  console.log("\nFOV bench — computeFov per call\n");
  const rows = [
    bench("rim 80×30, r=12", 50_000, scenario("rim", 12)),
    bench("rim 80×30, r=8", 50_000, scenario("rim", 8)),
    bench("rim 80×30, r=16", 50_000, scenario("rim", 16)),
    bench("caverns 80×30, r=12", 50_000, scenario("caverns", 12)),
  ];
  const header = "scenario                                  iters       ns/op";
  console.log(header);
  console.log("─".repeat(header.length));
  for (const r of rows) {
    console.log(
      `${r.scenario.padEnd(40)}${r.iters.toLocaleString().padStart(10)}${r.nsPerOp.toFixed(1).padStart(12)}`,
    );
  }
  console.log();
}
