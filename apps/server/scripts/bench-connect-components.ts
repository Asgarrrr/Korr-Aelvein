// Microbenchmark for the `connectComponents` pass. Run from `apps/server/`:
//   bun run scripts/bench-connect-components.ts
//
// Methodology:
//   1. Pre-generate a *fragmented* level once (seedCA + iterateCA only).
//   2. Time `connectComponents(level, rng)` over N calls, warm the JIT first.
//   3. Report median + min + max ns/op over R batches.
//
// `connectComponents` does not consult the RNG (its randomness is purely
// structural), so calling it repeatedly with a frozen input gives a stable
// per-call cost we can compare across refactors.
import { emptyLevel, runPipeline } from "../src/domain/dungeon/index";
import { connectComponents } from "../src/domain/dungeon/styles/caverns/connect-components";
import { iterateCA } from "../src/domain/dungeon/styles/caverns/iterate-ca";
import { seedCA } from "../src/domain/dungeon/styles/caverns/seed-ca";
import { createRng } from "../src/domain/rng/index";

const SIZES: ReadonlyArray<readonly [number, number]> = [
  [80, 30],
  [160, 60],
  [300, 150],
];
const WARMUP = 200;
const ITERS_PER_BATCH = 500;
const BATCHES = 7;
const BENCH_SEED = 42;

function median(xs: number[]): number {
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    const m = sorted[mid];
    if (m === undefined) throw new Error("median: empty");
    return m;
  }
  const a = sorted[mid - 1];
  const b = sorted[mid];
  if (a === undefined || b === undefined) throw new Error("median: empty");
  return (a + b) / 2;
}

function fragmentedLevel(w: number, h: number) {
  const rng = createRng(BENCH_SEED);
  return runPipeline(emptyLevel(w, h), rng, [
    seedCA({ wallProbability: 0.45 }),
    iterateCA({ iterations: 5, birthLimit: 5, survivalLimit: 4 }),
  ]);
}

function benchOnce(level: ReturnType<typeof fragmentedLevel>): number {
  const rng = createRng(0);
  const t0 = Bun.nanoseconds();
  for (let i = 0; i < ITERS_PER_BATCH; i++) connectComponents(level, rng);
  return Bun.nanoseconds() - t0;
}

console.log(
  `\nconnectComponents bench — ${BATCHES} batches × ${ITERS_PER_BATCH} iter (after ${WARMUP} warmup)\n`,
);
console.log(
  `${"size".padEnd(12)} ${"min ns/op".padStart(14)} ${"median ns/op".padStart(14)} ${"max ns/op".padStart(14)} ${"median µs/op".padStart(14)}`,
);
console.log("─".repeat(70));

for (const [w, h] of SIZES) {
  const level = fragmentedLevel(w, h);
  // Warm the JIT on this exact level shape.
  for (let i = 0; i < WARMUP; i++) connectComponents(level, createRng(0));

  const batchNs: number[] = [];
  for (let b = 0; b < BATCHES; b++) batchNs.push(benchOnce(level));

  const perOp = batchNs.map((ns) => ns / ITERS_PER_BATCH);
  const mn = Math.min(...perOp);
  const md = median(perOp);
  const mx = Math.max(...perOp);
  console.log(
    `${`${w}×${h}`.padEnd(12)} ${mn.toFixed(0).padStart(14)} ${md.toFixed(0).padStart(14)} ${mx.toFixed(0).padStart(14)} ${(md / 1000).toFixed(2).padStart(14)}`,
  );
}
console.log();
