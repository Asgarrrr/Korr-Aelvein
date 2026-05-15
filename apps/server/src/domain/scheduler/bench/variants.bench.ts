/**
 * Variant bench: compare candidate implementations of the heap operations
 * against the baseline (`../index.ts`) on the same scenarios. Run with
 * `bun run bench:scheduler:variants` from `apps/server/`. For stable
 * numbers across V8 IC warmup + GC noise, use `bun run bench:scheduler:agg`
 * (30+-run aggregate with median + CV).
 *
 * Each variant is a self-contained set of operations sharing the same
 * external contract (`empty`, `schedule`, `pop`, `peek`, `removeWhere`).
 * Internal storage may differ — SoA has parallel arrays where the
 * baseline has an AoS object heap.
 *
 * Variants under test:
 *   V0  baseline                    re-import of production
 *   V1  inline-lessThan             manual inline of the comparator
 *                                   (V8 inline-cache hint)
 *   V2  soa-storage                 times[]/seqs[]/payloads[] parallel
 *                                   arrays — avoids per-push object alloc
 *   V3  in-place-removeWhere        compact in place instead of
 *                                   allocating a new survivor array
 *   V4  combined                    V1 + V3
 *
 * ── Verdict (30-run aggregate, 2026-05) ───────────────────────────────────
 *
 *   V0 / V4 ARE NOW IDENTICAL — production has absorbed V4. Re-running
 *   this bench from a future "I have a better idea" branch should compare
 *   that branch's V0 against V0/V4 here.
 *
 *   ADOPTED (now V0):
 *     V1 inline-lessThan + V3 in-place-removeWhere
 *     - removeWhere @ N=5000:  −17 % to −21 %  (Floyd heapify × inline LT)
 *     - removeWhere @ N=500:   −10 % to −14 %
 *     - cycle / drain / peek:  within CV (no regression)
 *
 *   REJECTED:
 *     V2 soa-storage (parallel times[]/seqs[]/payloads[])
 *     - schedule+pop cycle @ N=500:   +13 % SLOWER  (6-write swap vs 2)
 *     - drain N @ N=50:               +12 % SLOWER
 *     - removeWhere @ N=5000:         −14 to −18 % (matches V3, no gain)
 *     The cache-friendliness win on linear scans doesn't compensate for
 *     the 3× write cost on every heap swap. Object alloc on `schedule`
 *     turned out to be V8-amortized below the noise floor at our scale.
 *     Revisit only if (a) heap regularly exceeds N=10 000 AND (b) profile
 *     shows the AoS push site as the dominant alloc.
 *
 *     V1 inline-lessThan ALONE (without V3's in-place compact)
 *     - Marginal everywhere on cycle/drain (within CV).
 *     - Win on removeWhere only because Floyd calls bubbleDown N/2 times.
 *     - Kept paired with V3 in adopted version (compounds); not adopted
 *       solo since the helper-call `lessThan` was a readability win that
 *       the inline form gives up.
 */

import {
  emptyScheduler,
  peek,
  pop,
  removeWhere,
  type ScheduledEvent,
  type Scheduler,
  schedule,
} from "../index";

// Import-rename `import { X as Y }` is banned by the project rule; we use
// the public scheduler API directly from V0 instead of aliasing.

// ─── Common harness ──────────────────────────────────────────────────────────

type Payload = {
  readonly kind: "actor";
  readonly zone: number;
  readonly id: number;
};

function payloadFor(i: number): Payload {
  return { kind: "actor", zone: 0, id: i };
}

function makeRand(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = ((Math.imul(s, 1103515245) | 0) + 12345) | 0;
    return (s >>> 0) % 1000;
  };
}

export type Result = {
  readonly variant: string;
  readonly scenario: string;
  readonly n: number;
  readonly nsPerOp: number;
};

function timeIt(iters: number, fn: () => void): number {
  const warmup = Math.min(Math.max(iters >> 4, 100), 5_000);
  for (let i = 0; i < warmup; i++) fn();
  const start = performance.now();
  for (let i = 0; i < iters; i++) fn();
  const elapsed = performance.now() - start;
  return (elapsed * 1_000_000) / iters;
}

// ─── Variant interface ───────────────────────────────────────────────────────

type Ops<S> = {
  readonly name: string;
  readonly empty: () => S;
  readonly schedule: (s: S, delay: number, payload: Payload) => void;
  readonly pop: (s: S) => Payload | undefined;
  readonly peek: (s: S) => Payload | undefined;
  readonly removeWhereId: (s: S, pred: (id: number) => boolean) => void;
};

function buildN<S>(ops: Ops<S>, n: number, seed = 0xc0ffee): S {
  const s = ops.empty();
  const rand = makeRand(seed);
  for (let i = 0; i < n; i++) {
    ops.schedule(s, rand(), payloadFor(i));
  }
  return s;
}

// ─── V0 — baseline (AoS heap) ────────────────────────────────────────────────

export const V0: Ops<Scheduler<Payload>> = {
  name: "V0 baseline",
  empty: () => emptyScheduler<Payload>(),
  schedule: (s, d, p) => {
    schedule(s, d, p);
  },
  pop: (s) => pop(s)?.payload,
  peek: (s) => peek(s)?.payload,
  removeWhereId: (s, pred) => {
    removeWhere(s, (ev: ScheduledEvent<Payload>) => pred(ev.payload.id));
  },
};

// ─── V1 — inline lessThan (manual comparator inlining) ───────────────────────

type V1State = {
  heap: ScheduledEvent<Payload>[];
  now: number;
  nextSeq: number;
};

function v1BubbleUp(heap: ScheduledEvent<Payload>[], start: number): void {
  let i = start;
  while (i > 0) {
    const parent = (i - 1) >> 1;
    const cur = heap[i];
    const above = heap[parent];
    if (cur === undefined || above === undefined) return;
    const less =
      cur.time !== above.time ? cur.time < above.time : cur.seq < above.seq;
    if (!less) return;
    heap[i] = above;
    heap[parent] = cur;
    i = parent;
  }
}

function v1BubbleDown(heap: ScheduledEvent<Payload>[], start: number): void {
  let i = start;
  const n = heap.length;
  while (true) {
    const cur = heap[i];
    if (cur === undefined) return;
    const l = 2 * i + 1;
    const r = 2 * i + 2;
    let bestIdx = i;
    let bestEv = cur;
    if (l < n) {
      const lEv = heap[l];
      if (lEv !== undefined) {
        const less =
          lEv.time !== bestEv.time
            ? lEv.time < bestEv.time
            : lEv.seq < bestEv.seq;
        if (less) {
          bestIdx = l;
          bestEv = lEv;
        }
      }
    }
    if (r < n) {
      const rEv = heap[r];
      if (rEv !== undefined) {
        const less =
          rEv.time !== bestEv.time
            ? rEv.time < bestEv.time
            : rEv.seq < bestEv.seq;
        if (less) {
          bestIdx = r;
          bestEv = rEv;
        }
      }
    }
    if (bestIdx === i) return;
    heap[i] = bestEv;
    heap[bestIdx] = cur;
    i = bestIdx;
  }
}

export const V1: Ops<V1State> = {
  name: "V1 inline-lessThan",
  empty: () => ({ heap: [], now: 0, nextSeq: 0 }),
  schedule: (s, delay, payload) => {
    const ev: ScheduledEvent<Payload> = {
      time: s.now + delay,
      seq: s.nextSeq,
      payload,
    };
    s.nextSeq += 1;
    s.heap.push(ev);
    v1BubbleUp(s.heap, s.heap.length - 1);
  },
  pop: (s) => {
    const top = s.heap[0];
    if (top === undefined) return undefined;
    const last = s.heap.pop();
    if (s.heap.length > 0 && last !== undefined) {
      s.heap[0] = last;
      v1BubbleDown(s.heap, 0);
    }
    s.now = top.time;
    return top.payload;
  },
  peek: (s) => s.heap[0]?.payload,
  removeWhereId: (s, pred) => {
    const kept: ScheduledEvent<Payload>[] = [];
    for (const ev of s.heap) {
      if (!pred(ev.payload.id)) kept.push(ev);
    }
    s.heap = kept;
    for (let i = (kept.length >> 1) - 1; i >= 0; i--) {
      v1BubbleDown(s.heap, i);
    }
  },
};

// ─── V2 — SoA storage (parallel arrays, no per-push object) ──────────────────

type V2State = {
  times: number[];
  seqs: number[];
  payloads: Payload[];
  now: number;
  nextSeq: number;
};

function v2Less(s: V2State, i: number, j: number): boolean | undefined {
  const ti = s.times[i];
  const tj = s.times[j];
  if (ti === undefined || tj === undefined) return undefined;
  if (ti !== tj) return ti < tj;
  const si = s.seqs[i];
  const sj = s.seqs[j];
  if (si === undefined || sj === undefined) return undefined;
  return si < sj;
}

function v2Swap(s: V2State, i: number, j: number): void {
  const ti = s.times[i];
  const tj = s.times[j];
  const si = s.seqs[i];
  const sj = s.seqs[j];
  const pi = s.payloads[i];
  const pj = s.payloads[j];
  if (
    ti === undefined ||
    tj === undefined ||
    si === undefined ||
    sj === undefined ||
    pi === undefined ||
    pj === undefined
  ) {
    return;
  }
  s.times[i] = tj;
  s.times[j] = ti;
  s.seqs[i] = sj;
  s.seqs[j] = si;
  s.payloads[i] = pj;
  s.payloads[j] = pi;
}

function v2BubbleUp(s: V2State, start: number): void {
  let i = start;
  while (i > 0) {
    const parent = (i - 1) >> 1;
    const less = v2Less(s, i, parent);
    if (less !== true) return;
    v2Swap(s, i, parent);
    i = parent;
  }
}

function v2BubbleDown(s: V2State, start: number): void {
  let i = start;
  const n = s.times.length;
  while (true) {
    const l = 2 * i + 1;
    const r = 2 * i + 2;
    let bestIdx = i;
    if (l < n && v2Less(s, l, bestIdx) === true) bestIdx = l;
    if (r < n && v2Less(s, r, bestIdx) === true) bestIdx = r;
    if (bestIdx === i) return;
    v2Swap(s, i, bestIdx);
    i = bestIdx;
  }
}

export const V2: Ops<V2State> = {
  name: "V2 soa-storage",
  empty: () => ({ times: [], seqs: [], payloads: [], now: 0, nextSeq: 0 }),
  schedule: (s, delay, payload) => {
    s.times.push(s.now + delay);
    s.seqs.push(s.nextSeq);
    s.payloads.push(payload);
    s.nextSeq += 1;
    v2BubbleUp(s, s.times.length - 1);
  },
  pop: (s) => {
    const topT = s.times[0];
    const topP = s.payloads[0];
    if (topT === undefined || topP === undefined) return undefined;
    const lastT = s.times.pop();
    const lastSeq = s.seqs.pop();
    const lastP = s.payloads.pop();
    if (
      s.times.length > 0 &&
      lastT !== undefined &&
      lastSeq !== undefined &&
      lastP !== undefined
    ) {
      s.times[0] = lastT;
      s.seqs[0] = lastSeq;
      s.payloads[0] = lastP;
      v2BubbleDown(s, 0);
    }
    s.now = topT;
    return topP;
  },
  peek: (s) => s.payloads[0],
  removeWhereId: (s, pred) => {
    let write = 0;
    for (let read = 0; read < s.payloads.length; read++) {
      const p = s.payloads[read];
      const t = s.times[read];
      const sq = s.seqs[read];
      if (p === undefined || t === undefined || sq === undefined) continue;
      if (pred(p.id)) continue;
      s.times[write] = t;
      s.seqs[write] = sq;
      s.payloads[write] = p;
      write += 1;
    }
    s.times.length = write;
    s.seqs.length = write;
    s.payloads.length = write;
    for (let i = (write >> 1) - 1; i >= 0; i--) {
      v2BubbleDown(s, i);
    }
  },
};

// ─── V3 — in-place removeWhere on AoS heap ───────────────────────────────────

export const V3: Ops<Scheduler<Payload>> = {
  name: "V3 in-place-removeWhere",
  empty: () => emptyScheduler<Payload>(),
  schedule: (s, d, p) => {
    schedule(s, d, p);
  },
  pop: (s) => pop(s)?.payload,
  peek: (s) => peek(s)?.payload,
  removeWhereId: (s, pred) => {
    const heap = s.heap;
    let write = 0;
    for (let read = 0; read < heap.length; read++) {
      const ev = heap[read];
      if (ev === undefined) continue;
      if (pred(ev.payload.id)) continue;
      heap[write++] = ev;
    }
    heap.length = write;
    // Inline bubbleDown so we don't depend on the baseline's private one.
    // Same logic as baseline's bubbleDown.
    for (let i = (write >> 1) - 1; i >= 0; i--) {
      let j = i;
      const len = heap.length;
      while (true) {
        const cur = heap[j];
        if (cur === undefined) break;
        const l = 2 * j + 1;
        const r = 2 * j + 2;
        let bestIdx = j;
        let bestEv = cur;
        if (l < len) {
          const lEv = heap[l];
          if (lEv !== undefined) {
            const less =
              lEv.time !== bestEv.time
                ? lEv.time < bestEv.time
                : lEv.seq < bestEv.seq;
            if (less) {
              bestIdx = l;
              bestEv = lEv;
            }
          }
        }
        if (r < len) {
          const rEv = heap[r];
          if (rEv !== undefined) {
            const less =
              rEv.time !== bestEv.time
                ? rEv.time < bestEv.time
                : rEv.seq < bestEv.seq;
            if (less) {
              bestIdx = r;
              bestEv = rEv;
            }
          }
        }
        if (bestIdx === j) break;
        heap[j] = bestEv;
        heap[bestIdx] = cur;
        j = bestIdx;
      }
    }
  },
};

// ─── V4 — V1 + V3 combined (inline + in-place) ───────────────────────────────

export const V4: Ops<V1State> = {
  name: "V4 inline + in-place",
  empty: V1.empty,
  schedule: V1.schedule,
  pop: V1.pop,
  peek: V1.peek,
  removeWhereId: (s, pred) => {
    const heap = s.heap;
    let write = 0;
    for (let read = 0; read < heap.length; read++) {
      const ev = heap[read];
      if (ev === undefined) continue;
      if (pred(ev.payload.id)) continue;
      heap[write++] = ev;
    }
    heap.length = write;
    for (let i = (write >> 1) - 1; i >= 0; i--) {
      v1BubbleDown(heap, i);
    }
  },
};

// ─── Scenarios driven against any Ops ────────────────────────────────────────

const SCALES: readonly number[] = [50, 500, 5000];

function pickIters(n: number, fast: number, med: number, slow: number): number {
  if (n <= 50) return fast;
  if (n <= 500) return med;
  return slow;
}

export function runScenarios<S>(ops: Ops<S>): readonly Result[] {
  const rows: Result[] = [];
  for (const n of SCALES) {
    // S1 — schedule+pop cycle at heap=N
    {
      const s = buildN(ops, n);
      const rand = makeRand(0xfade);
      let counter = n;
      const iters = pickIters(n, 500_000, 200_000, 100_000);
      const ns = timeIt(iters, () => {
        ops.schedule(s, rand(), payloadFor(counter++));
        ops.pop(s);
      });
      rows.push({ variant: ops.name, scenario: "S1 cycle", n, nsPerOp: ns });
    }
    // S2 — peek
    {
      const s = buildN(ops, n);
      const ns = timeIt(1_000_000, () => {
        ops.peek(s);
      });
      rows.push({ variant: ops.name, scenario: "S2 peek", n, nsPerOp: ns });
    }
    // S3 — drain N
    {
      const iters = pickIters(n, 5_000, 1_000, 200);
      const ns = timeIt(iters, () => {
        const s = ops.empty();
        const rand = makeRand(0xbeef);
        for (let i = 0; i < n; i++) ops.schedule(s, rand(), payloadFor(i));
        for (let i = 0; i < n; i++) ops.pop(s);
      });
      rows.push({ variant: ops.name, scenario: "S3 drain N", n, nsPerOp: ns });
    }
    // S4 — removeWhere @ 0%
    {
      const iters = pickIters(n, 50_000, 10_000, 2_000);
      const ns = timeIt(iters, () => {
        const s = buildN(ops, n);
        ops.removeWhereId(s, () => false);
      });
      rows.push({
        variant: ops.name,
        scenario: "S4 removeWhere 0%",
        n,
        nsPerOp: ns,
      });
    }
    // S5 — removeWhere @ 50%
    {
      const iters = pickIters(n, 50_000, 10_000, 2_000);
      const ns = timeIt(iters, () => {
        const s = buildN(ops, n);
        let toggle = 0;
        ops.removeWhereId(s, () => (toggle++ & 1) === 0);
      });
      rows.push({
        variant: ops.name,
        scenario: "S5 removeWhere 50%",
        n,
        nsPerOp: ns,
      });
    }
    // S6 — removeWhere @ 100%
    {
      const iters = pickIters(n, 50_000, 10_000, 2_000);
      const ns = timeIt(iters, () => {
        const s = buildN(ops, n);
        ops.removeWhereId(s, () => true);
      });
      rows.push({
        variant: ops.name,
        scenario: "S6 removeWhere 100%",
        n,
        nsPerOp: ns,
      });
    }
  }
  return rows;
}

// ─── Run all variants, print comparison table ────────────────────────────────

// Each variant has its own internal state type S — a uniform `Ops<unknown>[]`
// would require an `as` cast that the project rule forbids. We list names
// separately (for the table layout) and call `runScenarios` once per variant
// with its concrete type at the call site, letting `S` infer.
const VARIANT_NAMES: readonly string[] = [
  V0.name,
  V1.name,
  V2.name,
  V3.name,
  V4.name,
];

function formatComparison(allResults: readonly Result[]): string {
  // Group by (scenario, n) — one row per benchmark, one column per variant.
  type Cell = { variantName: string; ns: number };
  const grouped = new Map<string, Cell[]>();
  for (const r of allResults) {
    const key = `${r.scenario}@${r.n}`;
    const existing = grouped.get(key);
    if (existing === undefined) {
      grouped.set(key, [{ variantName: r.variant, ns: r.nsPerOp }]);
    } else {
      existing.push({ variantName: r.variant, ns: r.nsPerOp });
    }
  }

  const lines: string[] = [];
  const header = [
    "scenario / N".padEnd(22),
    ...VARIANT_NAMES.map((v) => v.padStart(14)),
  ].join("");
  lines.push(header);
  lines.push("─".repeat(header.length));

  for (const [key, cells] of grouped) {
    const row = [key.padEnd(22)];
    const baseCell = cells.find((c) => c.variantName === V0.name);
    const baseNs = baseCell?.ns ?? null;
    for (const name of VARIANT_NAMES) {
      const cell = cells.find((c) => c.variantName === name);
      if (cell === undefined) {
        row.push("-".padStart(14));
        continue;
      }
      const nsStr = cell.ns.toFixed(1);
      if (baseNs === null || cell.variantName === V0.name) {
        row.push(nsStr.padStart(14));
      } else {
        const ratio = ((cell.ns / baseNs - 1) * 100).toFixed(0);
        const sign = ratio.startsWith("-") ? "" : "+";
        const tag = `${nsStr} (${sign}${ratio}%)`;
        row.push(tag.padStart(14));
      }
    }
    lines.push(row.join(""));
  }
  return lines.join("\n");
}

if (import.meta.main) {
  console.log("\nScheduler variants bench — ns/op vs baseline\n");
  const allResults: Result[] = [];
  console.log(`  running ${V0.name}…`);
  allResults.push(...runScenarios(V0));
  console.log(`  running ${V1.name}…`);
  allResults.push(...runScenarios(V1));
  console.log(`  running ${V2.name}…`);
  allResults.push(...runScenarios(V2));
  console.log(`  running ${V3.name}…`);
  allResults.push(...runScenarios(V3));
  console.log(`  running ${V4.name}…`);
  allResults.push(...runScenarios(V4));
  console.log();
  console.log(formatComparison(allResults));
  console.log();
}
