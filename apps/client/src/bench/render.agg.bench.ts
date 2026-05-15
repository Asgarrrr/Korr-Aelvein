/**
 * Aggregate renderer bench — runs the discovery suite RUNS times, reports
 * median + p95 + CV per scenario. Separates real per-call cost from V8/JSC
 * IC warmup and GC noise.
 *
 * Run: `bun run bench:render:agg` from `apps/client/`. Default RUNS=30.
 */

import { runAll } from "./render.bench";

const RUNS = Number(process.env["RUNS"] ?? 30);

type Stats = {
  readonly median: number;
  readonly p95: number;
  readonly mean: number;
  readonly stdev: number;
};

function stats(values: readonly number[]): Stats {
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  const sum = sorted.reduce((acc, v) => acc + v, 0);
  const mean = sum / n;
  const p95Idx = Math.min(n - 1, Math.floor(n * 0.95));
  const p95 = sorted[p95Idx];
  if (p95 === undefined) throw new Error("stats: p95 out of range");
  let median: number;
  if (n % 2 === 1) {
    const mid = sorted[(n - 1) / 2];
    if (mid === undefined) throw new Error("stats: median out of range");
    median = mid;
  } else {
    const lo = sorted[n / 2 - 1];
    const hi = sorted[n / 2];
    if (lo === undefined || hi === undefined) {
      throw new Error("stats: median out of range");
    }
    median = (lo + hi) / 2;
  }
  const variance = sorted.reduce((acc, v) => acc + (v - mean) ** 2, 0) / n;
  return { median, p95, mean, stdev: Math.sqrt(variance) };
}

type Bucket = { nsValues: number[]; outputBytes: number };

function aggregate(): Map<string, Bucket> {
  const buckets = new Map<string, Bucket>();
  for (let i = 0; i < RUNS; i++) {
    const results = runAll();
    for (const r of results) {
      const existing = buckets.get(r.scenario);
      if (existing === undefined) {
        buckets.set(r.scenario, {
          nsValues: [r.nsPerOp],
          outputBytes: r.outputBytes,
        });
      } else {
        existing.nsValues.push(r.nsPerOp);
      }
    }
    if ((i + 1) % 5 === 0) {
      console.log(`  ${i + 1}/${RUNS} runs done`);
    }
  }
  return buckets;
}

function format(buckets: Map<string, Bucket>): string {
  const lines: string[] = [];
  lines.push(
    `\nRenderer bench aggregate — median ns/op over ${RUNS} runs (CV in parens)\n`,
  );
  const header =
    "scenario                                    median ns/op   p95 ns/op   output (B)";
  lines.push(header);
  lines.push("─".repeat(header.length));
  for (const [scenario, bucket] of buckets) {
    const s = stats(bucket.nsValues);
    const cv = ((s.stdev / s.mean) * 100).toFixed(1);
    const sc = scenario.padEnd(42);
    const med = `${s.median.toFixed(0)} (${cv}%)`.padStart(14);
    const p95 = s.p95.toFixed(0).padStart(12);
    const bytes = bucket.outputBytes.toLocaleString().padStart(13);
    lines.push(`${sc}${med}${p95}${bytes}`);
  }
  return lines.join("\n");
}

if (import.meta.main) {
  console.log(
    `\nRenderer aggregate — ${RUNS} runs × 5 scenarios (baseline renderGrid)\n`,
  );
  const buckets = aggregate();
  console.log(format(buckets));
  console.log();
}

export type { Bucket, Stats };
export { aggregate, format };
