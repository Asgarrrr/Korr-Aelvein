/**
 * Quick perf measurement for the RNG. Run with `bun run bench` from
 * `apps/server/`. Not part of CI — for hand-tuning only.
 */
import { createRng } from "../index";

const ITERS = 1_000_000;

function bench(label: string, fn: () => void): void {
  // Warm-up — let the JIT settle before measuring.
  for (let i = 0; i < 50_000; i++) fn();

  const start = performance.now();
  for (let i = 0; i < ITERS; i++) fn();
  const elapsed = performance.now() - start;

  const opsPerSec = (ITERS / elapsed) * 1000;
  const nsPerOp = (elapsed * 1_000_000) / ITERS;
  console.log(
    `${label.padEnd(28)} ${opsPerSec.toFixed(0).padStart(12)} ops/s   ${nsPerOp.toFixed(1).padStart(8)} ns/op`,
  );
}

const rng = createRng(42);
const arr = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

console.log(`\nRNG bench — ${ITERS.toLocaleString()} iterations per case\n`);

bench("next()", () => {
  rng.next();
});
bench("int(0, 9)", () => {
  rng.int(0, 9);
});
bench("int(0, 1_000_000)", () => {
  rng.int(0, 1_000_000);
});
bench("pick(arr[10])", () => {
  rng.pick(arr);
});
bench("chance(0.5)", () => {
  rng.chance(0.5);
});
bench("state()", () => {
  rng.state();
});

// split() advances the parent by 4 outputs and allocates a new Rng;
// measure the full cost.
bench("split()", () => {
  rng.split();
});

console.log();
