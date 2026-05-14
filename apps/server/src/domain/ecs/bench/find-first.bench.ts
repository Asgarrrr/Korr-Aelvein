// Find-first counter-bench. Codex challenged the `query` generator's
// existence by asking whether `forQuery` with a flag workaround could be
// strictly better. The answer is "no when break exits early"; this bench
// quantifies how much. Build a world of N entities, find the one whose
// position.x matches a target, measure ns/op for both APIs at target index
// {0, N/4, N/2, 3N/4, miss}.
//
// Each pair is timed 50 times in-process; report median, mean, CV.

import { emptyWorld, forQuery, query, spawn, type World } from "../index";

const N = 5000;
const RUNS = 50;
const ITERS = 5_000; // calls of the find-first loop per timed window

function buildWorld(): World {
  const w = emptyWorld();
  for (let i = 0; i < N; i++) {
    spawn(w, { position: { x: i, y: 0 } });
  }
  return w;
}

function findViaQuery(w: World, target: number): number | undefined {
  for (const [h, e] of query(w, ["position"])) {
    if (e.position.x === target) return h.id;
  }
  return undefined;
}

function findViaForQuery(w: World, target: number): number | undefined {
  let found: number | undefined;
  forQuery(w, ["position"], (h, e) => {
    if (found !== undefined) return; // flag workaround — keeps scanning
    if (e.position.x === target) found = h.id;
  });
  return found;
}

function timeNsPerOp(fn: () => void): number {
  for (let i = 0; i < 200; i++) fn(); // warmup
  const start = performance.now();
  for (let i = 0; i < ITERS; i++) fn();
  const elapsed = performance.now() - start;
  return (elapsed * 1_000_000) / ITERS;
}

function stats(values: number[]): {
  median: number;
  mean: number;
  cv: number;
} {
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  const mean = sorted.reduce((a, b) => a + b, 0) / n;
  const lo = sorted[(n - 1) >> 1];
  const hi = sorted[n >> 1];
  if (lo === undefined || hi === undefined) {
    throw new Error("stats: empty");
  }
  const median = n % 2 === 1 ? lo : (lo + hi) / 2;
  const variance = sorted.reduce((a, v) => a + (v - mean) ** 2, 0) / n;
  const stdev = Math.sqrt(variance);
  return { median, mean, cv: (stdev / mean) * 100 };
}

type Position =
  | "first (idx 0)"
  | "Q1 (idx N/4)"
  | "mid (idx N/2)"
  | "Q3 (idx 3N/4)"
  | "last (idx N-1)"
  | "miss";

const TARGETS: ReadonlyArray<{ name: Position; target: number }> = [
  { name: "first (idx 0)", target: 0 },
  { name: "Q1 (idx N/4)", target: Math.floor(N / 4) },
  { name: "mid (idx N/2)", target: Math.floor(N / 2) },
  { name: "Q3 (idx 3N/4)", target: Math.floor((3 * N) / 4) },
  { name: "last (idx N-1)", target: N - 1 },
  { name: "miss", target: N + 1 },
];

const w = buildWorld();

console.log(
  `\nFind-first bench — N=${N}, ITERS=${ITERS} per window, ${RUNS} runs per cell.`,
);
console.log(
  "scenario       target         query µs/op (CV)     forQuery µs/op (CV)    Δ",
);
console.log(
  "─────────────────────────────────────────────────────────────────────────────",
);

for (const { name, target } of TARGETS) {
  const queryNs: number[] = [];
  const forQueryNs: number[] = [];
  for (let r = 0; r < RUNS; r++) {
    queryNs.push(timeNsPerOp(() => findViaQuery(w, target)));
    forQueryNs.push(timeNsPerOp(() => findViaForQuery(w, target)));
  }
  const q = stats(queryNs);
  const fq = stats(forQueryNs);
  const delta = ((fq.median - q.median) / q.median) * 100;
  const sign = delta >= 0 ? "+" : "";
  console.log(
    `${name.padEnd(16)} ${String(target).padStart(6)}` +
      `   ${(q.median / 1000).toFixed(2).padStart(10)} (${q.cv.toFixed(1)}%)` +
      `   ${(fq.median / 1000).toFixed(2).padStart(10)} (${fq.cv.toFixed(1)}%)` +
      `   ${sign}${delta.toFixed(1)}%`,
  );
}
console.log();
