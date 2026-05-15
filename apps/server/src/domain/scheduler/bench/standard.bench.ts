/**
 * Quantified baseline for the scheduler's hot operations. Run with
 * `bun run bench:scheduler` from `apps/server/`. Not part of CI — used
 * locally before and after a perf change to verify the win.
 *
 * Heap operations are O(log N), so we measure at three scales (50 / 500 /
 * 5000) to see how each path scales. The realistic in-game workload sits
 * far below N=5000; the larger scale is there to expose perf differences
 * that vanish in the noise at N=50.
 *
 * BENCH HYGIENE: every scenario rebuilds a fresh scheduler. `schedule`-only
 * and `pop`-only loops would grow / shrink the heap mid-measurement — we
 * use schedule+pop cycles instead so the heap stays at N for the duration.
 * Per-op cost is half the cycle time (one push + one pop).
 *
 * Scenarios:
 *   S1  schedule+pop cycle    (the canonical tick churn — push then pop)
 *   S2  peek                  (sanity, O(1))
 *   S3  drain N               (schedule N then pop N — sort-and-drain cost)
 *   S4  removeWhere @ 0%      (Phase 6 zone transition, no matches)
 *   S5  removeWhere @ 50%     (Phase 6 zone transition, typical case)
 *   S6  removeWhere @ 100%    (worst case for re-heapify)
 */
import {
  emptyScheduler,
  peek,
  pop,
  removeWhere,
  type Scheduler,
  schedule,
} from "../index";

// ─── Harness ──────────────────────────────────────────────────────────────────

export type Result = {
  readonly scenario: string;
  readonly n: number;
  readonly iters: number;
  readonly nsPerOp: number;
  readonly opsPerSec: number;
};

function bench(
  scenario: string,
  n: number,
  iters: number,
  fn: () => void,
): Result {
  const warmup = Math.min(Math.max(iters >> 4, 100), 5_000);
  for (let i = 0; i < warmup; i++) fn();

  const start = performance.now();
  for (let i = 0; i < iters; i++) fn();
  const elapsed = performance.now() - start;

  const nsPerOp = (elapsed * 1_000_000) / iters;
  const opsPerSec = (iters / elapsed) * 1000;
  return { scenario, n, iters, nsPerOp, opsPerSec };
}

function formatTable(rows: readonly Result[]): string {
  const header =
    "scenario                              N    iters       ns/op           ops/s";
  const sep =
    "─────────────────────────────────────────────────────────────────────────────";
  const lines = rows.map((r) => {
    const sc = r.scenario.padEnd(34);
    const n = String(r.n).padStart(6);
    const it = r.iters.toLocaleString().padStart(10);
    const ns = r.nsPerOp.toFixed(1).padStart(12);
    const ops = Math.round(r.opsPerSec).toLocaleString().padStart(15);
    return `${sc}${n}${it}${ns}${ops}`;
  });
  return [header, sep, ...lines].join("\n");
}

// ─── Fixtures ────────────────────────────────────────────────────────────────

// Payload is a plain object — closer to real `GlobalEvent` than a bare number.
// The shape doesn't affect heap arithmetic (compared by `time` then `seq`),
// but the alloc cost on `schedule` is what we want to surface.
type Payload = {
  readonly kind: "actor";
  readonly zone: number;
  readonly id: number;
};

function payloadFor(i: number): Payload {
  return { kind: "actor", zone: 0, id: i };
}

// Pseudo-random delay distribution. Inlined LCG for determinism without
// pulling in the `Rng` (keeps the bench module dependency-light).
function makeRand(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = ((Math.imul(s, 1103515245) | 0) + 12345) | 0;
    return (s >>> 0) % 1000;
  };
}

function buildSchedulerN(n: number, seed = 0xc0ffee): Scheduler<Payload> {
  const s = emptyScheduler<Payload>();
  const rand = makeRand(seed);
  for (let i = 0; i < n; i++) {
    schedule(s, rand(), payloadFor(i));
  }
  return s;
}

// ─── Scenarios ───────────────────────────────────────────────────────────────

const SCALES: readonly number[] = [50, 500, 5000];

function pickIters(n: number, fast: number, med: number, slow: number): number {
  if (n <= 50) return fast;
  if (n <= 500) return med;
  return slow;
}

export function runAll(): readonly Result[] {
  const rows: Result[] = [];

  for (const n of SCALES) {
    // S1 — schedule+pop cycle. Push one, pop one — heap stays at N for the
    // measurement window. Each iter = one cycle (one push + one pop), so
    // ns/op is the per-cycle cost; divide by 2 for per-op.
    {
      const s = buildSchedulerN(n);
      const rand = makeRand(0xfade);
      const iters = pickIters(n, 500_000, 200_000, 100_000);
      let counter = n;
      rows.push(
        bench("S1 schedule+pop cycle (heap=N)", n, iters, () => {
          schedule(s, rand(), payloadFor(counter++));
          pop(s);
        }),
      );
    }

    // S2 — peek. O(1) array index read + return.
    {
      const s = buildSchedulerN(n);
      rows.push(
        bench("S2 peek (heap=N)", n, 1_000_000, () => {
          peek(s);
        }),
      );
    }

    // S3 — drain N: schedule N fresh events then pop all N. Measures the
    // full sort-and-drain throughput. Per-op = (push+pop) time / 2.
    {
      const iters = pickIters(n, 5_000, 1_000, 200);
      rows.push(
        bench("S3 drain N (schedule N, pop N)", n, iters, () => {
          const s = emptyScheduler<Payload>();
          const rand = makeRand(0xbeef);
          for (let i = 0; i < n; i++) schedule(s, rand(), payloadFor(i));
          for (let i = 0; i < n; i++) pop(s);
        }),
      );
    }

    // S4 — removeWhere @ 0% match. Pure scan + heapify-of-same-array cost.
    // Rebuilt per iter — `removeWhere` mutates in place.
    {
      const iters = pickIters(n, 50_000, 10_000, 2_000);
      rows.push(
        bench("S4 removeWhere @ 0% match", n, iters, () => {
          const s = buildSchedulerN(n);
          removeWhere(s, () => false);
        }),
      );
    }

    // S5 — removeWhere @ 50% match. Typical Phase 6 zone-transition load —
    // dropping one zone's events from a multi-zone heap.
    {
      const iters = pickIters(n, 50_000, 10_000, 2_000);
      rows.push(
        bench("S5 removeWhere @ 50% match", n, iters, () => {
          const s = buildSchedulerN(n);
          let toggle = 0;
          removeWhere(s, () => (toggle++ & 1) === 0);
        }),
      );
    }

    // S6 — removeWhere @ 100% match. Worst case: every event dropped, then
    // a Floyd heapify on an empty array (the early-return inside removeWhere
    // takes the size === 0 short path).
    {
      const iters = pickIters(n, 50_000, 10_000, 2_000);
      rows.push(
        bench("S6 removeWhere @ 100% match", n, iters, () => {
          const s = buildSchedulerN(n);
          removeWhere(s, () => true);
        }),
      );
    }
  }

  return rows;
}

// ─── Entry ────────────────────────────────────────────────────────────────────

if (import.meta.main) {
  console.log("\nScheduler bench — baseline (binary heap, AoS events)\n");
  const results = runAll();
  console.log(formatTable(results));
  console.log();
}
