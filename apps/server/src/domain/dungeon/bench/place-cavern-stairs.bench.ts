// Microbenchmark for the `placeCavernStairs` pass. Pre-builds a connected
// level once (seedCA + iterateCA + connect + spawn) then times the pass
// over N calls per batch, R batches. Used to validate the inline `for-k`
// BFS body over the bench-rejected `visit()`-closure alternative.
import { createRng } from "../../rng/index";
import { emptyLevel, runPipeline } from "../index";
import { connectComponents } from "../styles/caverns/connect-components";
import { iterateCA } from "../styles/caverns/iterate-ca";
import { placeCavernSpawn } from "../styles/caverns/place-cavern-spawn";
import { placeCavernStairs } from "../styles/caverns/place-cavern-stairs";
import { seedCA } from "../styles/caverns/seed-ca";

const SIZES: ReadonlyArray<readonly [number, number]> = [
  [80, 30],
  [160, 60],
  [300, 150],
];
const WARMUP = 200;
const ITERS_PER_BATCH = 1000;
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

function connectedLevel(w: number, h: number) {
  const rng = createRng(BENCH_SEED);
  return runPipeline(emptyLevel(w, h), rng, [
    seedCA({ wallProbability: 0.45 }),
    iterateCA({ iterations: 5, birthLimit: 5, survivalLimit: 4 }),
    connectComponents,
    placeCavernSpawn,
  ]);
}

function benchOnce(level: ReturnType<typeof connectedLevel>): number {
  const rng = createRng(0);
  const t0 = Bun.nanoseconds();
  for (let i = 0; i < ITERS_PER_BATCH; i++) placeCavernStairs(level, rng);
  return Bun.nanoseconds() - t0;
}

console.log(
  `\nplaceCavernStairs bench — ${BATCHES} batches × ${ITERS_PER_BATCH} iter (after ${WARMUP} warmup)\n`,
);
console.log(
  `${"size".padEnd(12)} ${"min ns/op".padStart(14)} ${"median ns/op".padStart(14)} ${"max ns/op".padStart(14)} ${"median µs/op".padStart(14)}`,
);
console.log("─".repeat(70));

for (const [w, h] of SIZES) {
  const level = connectedLevel(w, h);
  for (let i = 0; i < WARMUP; i++) placeCavernStairs(level, createRng(0));

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
