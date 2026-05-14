// Run each ECS bench suite RUNS times in-process, aggregate per-scenario,
// write JSON. Stable estimates (median) for documenting / regressing perf
// claims. Variance figures (stdev, p95) flag scenarios that are too noisy
// to trust a single run.
//
// Tradeoff: in-process loop means JIT warms across iterations — numbers are
// closer to steady-state than fresh-process, lower variance, no cold-start
// noise captured. For our use case (claim a stable baseline) that's correct.

import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { type Result, runAll as runMega } from "./mega.bench";
import { runAll as runStandard } from "./standard.bench";

const RUNS = Number(process.env["RUNS"] ?? 100);
const OUT_PATH =
  process.env["OUT"] ??
  join(dirname(fileURLToPath(import.meta.url)), "results.json");

type Stats = {
  readonly min: number;
  readonly mean: number;
  readonly median: number;
  readonly p95: number;
  readonly max: number;
  readonly stdev: number;
};

type AggregatedScenario = {
  readonly scenario: string;
  readonly n: number;
  readonly iters: number;
  readonly ns_per_op: Stats;
  readonly ops_per_sec: Stats;
};

type SuiteAggregate = {
  readonly name: string;
  readonly elapsed_ms: number;
  readonly scenarios: AggregatedScenario[];
};

type Output = {
  readonly timestamp: string;
  readonly runtime: string;
  readonly runs: number;
  readonly suites: SuiteAggregate[];
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
  let medianValue: number;
  if (n % 2 === 1) {
    const mid = sorted[(n - 1) / 2];
    if (mid === undefined) throw new Error("stats: median out of range");
    medianValue = mid;
  } else {
    const lo = sorted[n / 2 - 1];
    const hi = sorted[n / 2];
    if (lo === undefined || hi === undefined) {
      throw new Error("stats: median out of range");
    }
    medianValue = (lo + hi) / 2;
  }
  const variance = sorted.reduce((acc, v) => acc + (v - mean) ** 2, 0) / n;
  return {
    min: first,
    mean,
    median: medianValue,
    p95,
    max: last,
    stdev: Math.sqrt(variance),
  };
}

function key(r: Result): string {
  return `${r.scenario}|${r.n}`;
}

function aggregate(
  name: string,
  runner: () => readonly Result[],
): SuiteAggregate {
  const buckets = new Map<
    string,
    {
      scenario: string;
      n: number;
      iters: number;
      ns: number[];
      ops: number[];
    }
  >();

  const start = performance.now();
  for (let i = 0; i < RUNS; i++) {
    const results = runner();
    for (const r of results) {
      const k = key(r);
      let bucket = buckets.get(k);
      if (bucket === undefined) {
        bucket = {
          scenario: r.scenario,
          n: r.n,
          iters: r.iters,
          ns: [],
          ops: [],
        };
        buckets.set(k, bucket);
      }
      bucket.ns.push(r.nsPerOp);
      bucket.ops.push(r.opsPerSec);
    }
    if ((i + 1) % 10 === 0) {
      console.log(`  [${name}] ${i + 1}/${RUNS} runs done`);
    }
  }
  const elapsed_ms = performance.now() - start;

  const scenarios: AggregatedScenario[] = [];
  for (const bucket of buckets.values()) {
    scenarios.push({
      scenario: bucket.scenario,
      n: bucket.n,
      iters: bucket.iters,
      ns_per_op: stats(bucket.ns),
      ops_per_sec: stats(bucket.ops),
    });
  }
  return { name, elapsed_ms, scenarios };
}

function formatStats(label: string, s: Stats, unit: string): string {
  const fmt = (v: number) => v.toFixed(2).padStart(10);
  const cv = ((s.stdev / s.mean) * 100).toFixed(1);
  return `  ${label.padEnd(34)} median=${fmt(s.median)} mean=${fmt(s.mean)} stdev=${fmt(s.stdev)} (${cv}%) ${unit}`;
}

function printSummary(out: Output): void {
  for (const suite of out.suites) {
    console.log(
      `\n── ${suite.name} (${(suite.elapsed_ms / 1000).toFixed(1)}s)`,
    );
    for (const sc of suite.scenarios) {
      const label = `${sc.scenario} @${sc.n}`;
      console.log(formatStats(label, sc.ns_per_op, "ns/op"));
    }
  }
}

console.log(
  `\nECS bench — aggregating ${RUNS} runs per scenario (standard + mega).\n`,
);

const suites: SuiteAggregate[] = [
  aggregate("standard", runStandard),
  aggregate("mega", runMega),
];

const out: Output = {
  timestamp: new Date().toISOString(),
  runtime: `Bun ${Bun.version}`,
  runs: RUNS,
  suites,
};

writeFileSync(OUT_PATH, `${JSON.stringify(out, null, 2)}\n`);
console.log(`\nWrote ${OUT_PATH}`);
printSummary(out);
console.log();
