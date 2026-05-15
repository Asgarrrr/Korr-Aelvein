/**
 * Aggregate scheduler variants bench: run the variants suite RUNS times,
 * report median + p95 + stdev per (variant, scenario, N). Stable estimates
 * for documenting / regressing the optimization pass — a single run's noise
 * (V8 IC warmup, GC pauses, timer jitter) was visibly distorting comparisons
 * at the 5–10% scale.
 *
 * Run with `bun run bench:scheduler:agg` from `apps/server/`. Override RUNS
 * via env (default 50; the ECS aggregator defaults to 100, but each scheduler
 * pass is heavier per run).
 *
 * Decision criterion: a variant is "adopted" if its median wins at every
 * scale or every scenario class consistently, AND the gap exceeds the
 * baseline's coefficient-of-variation. Inconsistent wins are bench noise.
 */

import {
  type Result,
  runScenarios,
  V0,
  V1,
  V2,
  V3,
  V4,
} from "./variants.bench";

const RUNS = Number(process.env["RUNS"] ?? 50);

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

function key(variant: string, scenario: string, n: number): string {
  return `${variant}||${scenario}||${n}`;
}

function unkey(k: string): { variant: string; scenario: string; n: number } {
  const parts = k.split("||");
  const variant = parts[0];
  const scenario = parts[1];
  const nStr = parts[2];
  if (variant === undefined || scenario === undefined || nStr === undefined) {
    throw new Error(`unkey: malformed key ${k}`);
  }
  return { variant, scenario, n: Number(nStr) };
}

type Bucket = { values: number[] };

function aggregate(): Map<string, Bucket> {
  const buckets = new Map<string, Bucket>();
  const collect = (results: readonly Result[]): void => {
    for (const r of results) {
      const k = key(r.variant, r.scenario, r.n);
      const existing = buckets.get(k);
      if (existing === undefined) {
        buckets.set(k, { values: [r.nsPerOp] });
      } else {
        existing.values.push(r.nsPerOp);
      }
    }
  };
  for (let i = 0; i < RUNS; i++) {
    collect(runScenarios(V0));
    collect(runScenarios(V1));
    collect(runScenarios(V2));
    collect(runScenarios(V3));
    collect(runScenarios(V4));
    if ((i + 1) % 10 === 0) {
      console.log(`  ${i + 1}/${RUNS} runs done`);
    }
  }
  return buckets;
}

function pad(s: string, w: number, left = false): string {
  return left ? s.padStart(w) : s.padEnd(w);
}

function format(buckets: Map<string, Bucket>): string {
  // Group by (scenario, n); columns = variants.
  const variants = [V0.name, V1.name, V2.name, V3.name, V4.name];
  const scenarioKeys = new Set<string>();
  for (const k of buckets.keys()) {
    const u = unkey(k);
    scenarioKeys.add(`${u.scenario}||${u.n}`);
  }

  const lines: string[] = [];
  lines.push(
    `\nScheduler variants — median ns/op over ${RUNS} runs (delta% vs V0, CV in parens)\n`,
  );
  const header =
    pad("scenario / N", 24) + variants.map((v) => pad(v, 18, true)).join("");
  lines.push(header);
  lines.push("─".repeat(header.length));

  for (const sk of scenarioKeys) {
    const sParts = sk.split("||");
    const scenario = sParts[0];
    const nStr = sParts[1];
    if (scenario === undefined || nStr === undefined) continue;
    const n = Number(nStr);
    const baselineBucket = buckets.get(key(V0.name, scenario, n));
    if (baselineBucket === undefined) continue;
    const baseStats = stats(baselineBucket.values);
    const row = [pad(`${scenario}@${n}`, 24)];
    for (const v of variants) {
      const bucket = buckets.get(key(v, scenario, n));
      if (bucket === undefined) {
        row.push(pad("-", 18, true));
        continue;
      }
      const st = stats(bucket.values);
      const cv = ((st.stdev / st.mean) * 100).toFixed(1);
      if (v === V0.name) {
        row.push(pad(`${st.median.toFixed(1)} (${cv}%)`, 18, true));
      } else {
        const delta = ((st.median / baseStats.median - 1) * 100).toFixed(0);
        const sign = delta.startsWith("-") ? "" : "+";
        row.push(pad(`${st.median.toFixed(1)} ${sign}${delta}%`, 18, true));
      }
    }
    lines.push(row.join(""));
  }
  return lines.join("\n");
}

if (import.meta.main) {
  console.log(
    `\nScheduler variants aggregate — ${RUNS} runs × 5 variants × 6 scenarios × 3 scales\n`,
  );
  const buckets = aggregate();
  console.log(format(buckets));
  console.log();
}
