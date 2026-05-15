/**
 * Aggregate snapshot bench — runs the discovery suite RUNS times,
 * reports median + p95 + CV per scenario. Separates real per-call cost
 * from V8 IC warmup + GC noise.
 *
 * Run: `bun run bench:snapshot:agg` from `apps/server/`. Default RUNS=30;
 * override via env.
 */

import { type Result, runAll } from "./snapshot.bench";

const RUNS = Number(process.env["RUNS"] ?? 30);

type Stats = {
  readonly min: number;
  readonly median: number;
  readonly p95: number;
  readonly max: number;
  readonly mean: number;
  readonly stdev: number;
};

function stats(values: readonly number[]): Stats {
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  const first = sorted[0];
  const last = sorted[n - 1];
  if (first === undefined || last === undefined) {
    throw new Error("stats: empty values");
  }
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
  return {
    min: first,
    median,
    p95,
    max: last,
    mean,
    stdev: Math.sqrt(variance),
  };
}

type Bucket = { nsValues: number[]; payloadBytes: number };

function aggregate(): Map<string, Bucket> {
  const buckets = new Map<string, Bucket>();
  for (let i = 0; i < RUNS; i++) {
    const results = runAll();
    for (const r of results) {
      const existing = buckets.get(r.scenario);
      if (existing === undefined) {
        buckets.set(r.scenario, {
          nsValues: [r.nsPerOp],
          payloadBytes: r.payloadBytes,
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
    `\nSnapshot bench aggregate — median ns/op over ${RUNS} runs (CV in parens)\n`,
  );
  const header =
    "scenario                                  median ns/op   p95 ns/op    payload (B)";
  lines.push(header);
  lines.push("─".repeat(header.length));
  for (const [scenario, bucket] of buckets) {
    const s = stats(bucket.nsValues);
    const cv = ((s.stdev / s.mean) * 100).toFixed(1);
    const sc = scenario.padEnd(40);
    const med = `${s.median.toFixed(0)} (${cv}%)`.padStart(14);
    const p95 = s.p95.toFixed(0).padStart(12);
    const bytes = bucket.payloadBytes.toLocaleString().padStart(15);
    lines.push(`${sc}${med}${p95}${bytes}`);
  }
  return lines.join("\n");
}

if (import.meta.main) {
  console.log(
    `\nSnapshot aggregate — ${RUNS} runs × 4 scenarios (full toSnapshot)\n`,
  );
  const buckets = aggregate();
  console.log(format(buckets));
  console.log();
}

// Re-export Result so consumers don't need a transitive import dance.
export type { Bucket, Result, Stats };
// Keep imports satisfied even when not entry-point.
export { aggregate, format };
