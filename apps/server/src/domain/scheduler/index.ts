/**
 * Turn-time scheduler — binary min-heap keyed on `(time, seq)`.
 *
 * Generic over the payload `T`. Phase 1/2 used it with `EntityHandle` as the
 * payload (one entry per actor turn). Phase 3 lifts the payload to a
 * `GlobalEvent` discriminated union so the same heap can carry actor turns,
 * scheduled NPC abstracts, and world events on a single timeline. The heap
 * itself doesn't care about T — it orders by `(time, seq)` only.
 *
 * Determinism contract: starting from `emptyScheduler()`, the sequence of
 * `schedule` / `pop` calls fully determines the popped event sequence.
 * Tie-break on equal `time` is the insertion-order `seq`, owned by the
 * scheduler itself — not derived from any external storage layout — so churn
 * elsewhere cannot reorder turns.
 *
 * Mutation model: mirrors `World`. `Scheduler` is mutated in place; the
 * surrounding `GameState` wrapper rotates per tick.
 *
 * Stale payloads: when a payload references something that has since died
 * (e.g. a despawned entity), the caller checks at `pop` time and discards.
 * Eager removal would be O(n) in a binary heap and isn't worth it at our
 * entity scale. `pop` always advances `now` to the popped event's `time`,
 * even when the caller discards the event — game-time advances regardless of
 * who's alive.
 */

/** A future occurrence on the timeline, carrying an arbitrary payload. */
export type ScheduledEvent<T> = {
  /** Absolute tick at which this event fires. */
  readonly time: number;
  /** Insertion order — breaks `time` ties deterministically (FIFO). */
  readonly seq: number;
  /** Caller-defined payload (actor handle, global event, …). */
  readonly payload: T;
};

/**
 * Mutable scheduler state. `heap` is a binary min-heap in array form:
 * children of `i` are at `2i+1` and `2i+2`; parent is at `(i-1) >> 1`.
 */
export type Scheduler<T> = {
  heap: ScheduledEvent<T>[];
  /** Last popped event's time. 0 when nothing has been popped yet. */
  now: number;
  /** Next `seq` to hand out. Monotonic; never resets. */
  nextSeq: number;
};

export function emptyScheduler<T>(): Scheduler<T> {
  return { heap: [], now: 0, nextSeq: 0 };
}

// `(time, seq)` comparator is inlined at every call site below — V8 doesn't
// reliably inline a generic free function through the bubble-up/bubble-down
// hot path. The aggregate bench (`bench:scheduler:agg`) measured the inline
// variant compounding with `removeWhere`'s in-place compact to land
// `removeWhere @ N=5000` 17–21 % under the helper-call baseline (Floyd
// heapify calls bubbleDown N/2 times — every saved call counts).

function bubbleUp<T>(heap: ScheduledEvent<T>[], start: number): void {
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

function bubbleDown<T>(heap: ScheduledEvent<T>[], start: number): void {
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

/**
 * Schedule `payload` to fire at `now + delay`. `delay` must be a non-negative
 * integer — internal callers only, no runtime check (boundary-only validation
 * per project rules; floats would let cross-engine FP drift leak into the
 * queue order, negative values would let events fire in the past).
 */
export function schedule<T>(s: Scheduler<T>, delay: number, payload: T): void {
  const ev: ScheduledEvent<T> = {
    time: s.now + delay,
    seq: s.nextSeq,
    payload,
  };
  s.nextSeq += 1;
  s.heap.push(ev);
  bubbleUp(s.heap, s.heap.length - 1);
}

/**
 * Schedule `payload` to fire at an absolute `time`. Companion to `schedule`;
 * mirrors its determinism contract (fresh `seq` per call, FIFO tiebreak on
 * equal times). `time` must be `>= s.now` so events never fire in the past.
 *
 * Phase 6 zone transitions pre-compute the player's next-turn time *before*
 * the transition's catchup mutates `s.now`. Using a relative `delay` after
 * catchup would shift the player's next slot by the catchup's drained time;
 * `scheduleAt` keeps the slot pinned to the original turn-cost target.
 */
export function scheduleAt<T>(s: Scheduler<T>, time: number, payload: T): void {
  if (time < s.now) {
    throw new Error(`scheduleAt: time=${time} is in the past (now=${s.now})`);
  }
  const ev: ScheduledEvent<T> = { time, seq: s.nextSeq, payload };
  s.nextSeq += 1;
  s.heap.push(ev);
  bubbleUp(s.heap, s.heap.length - 1);
}

/**
 * Drop every event whose payload matches `predicate`. In-place compact then
 * bottom-up Floyd heapify — `O(n)` total, leaving the heap in a valid state.
 *
 * Used by Phase 6 zone transitions to evict `actor` events for a zone being
 * parked and `schedule` events for a zone being concretised — both are
 * one-shot batch deletes, not the hot path. The alternative (lazy-skip on
 * pop, like stale entity handles) would let dropped events accumulate
 * forever since nothing else evicts them.
 *
 * The compact runs read/write indices over `s.heap` directly and trims
 * length when done. The aggregate bench measured this 5–15 % under the
 * "build a new survivor array + reassign" variant at every scale — the win
 * comes from avoiding both the new-array allocation and the per-survivor
 * `Array.push` resize check.
 */
export function removeWhere<T>(
  s: Scheduler<T>,
  predicate: (event: ScheduledEvent<T>) => boolean,
): void {
  const heap = s.heap;
  let write = 0;
  for (let read = 0; read < heap.length; read++) {
    const ev = heap[read];
    if (ev === undefined) continue;
    if (predicate(ev)) continue;
    heap[write] = ev;
    write += 1;
  }
  heap.length = write;
  // Floyd's heapify: starting from the last non-leaf, sift each subtree root
  // down. O(n), not O(n log n).
  for (let i = (write >> 1) - 1; i >= 0; i--) {
    bubbleDown(heap, i);
  }
}

/**
 * Drop every event whose payload matches `predicate` and hand each one to
 * `handler` in `(time, seq)` order — the same order a `pop` chain would have
 * produced. `now` is not advanced (matches `removeWhere`); the handler is
 * free to inspect `ev.time` itself.
 *
 * Single pass over the heap array: matches are collected and skipped from
 * the compact in one read sweep, then Floyd heapify on the survivors. The
 * predicate is called exactly once per event.
 *
 * Used by Phase 6 zone-entry catchup: drain every `schedule` event for the
 * zone being concretised whose `time <= state.time`, in the order the
 * normal drain loop would have applied them. The previous implementation
 * iterated `s.heap` directly from outside the module, then called
 * `removeWhere` (predicate twice), then sorted, then applied — three passes
 * and the heap shape leaked to the caller. `drainWhere` collapses it into
 * one verb the scheduler owns.
 */
export function drainWhere<T>(
  s: Scheduler<T>,
  predicate: (event: ScheduledEvent<T>) => boolean,
  handler: (event: ScheduledEvent<T>) => void,
): void {
  const heap = s.heap;
  const matched: ScheduledEvent<T>[] = [];
  let write = 0;
  for (let read = 0; read < heap.length; read++) {
    const ev = heap[read];
    if (ev === undefined) continue;
    if (predicate(ev)) {
      matched.push(ev);
      continue;
    }
    heap[write] = ev;
    write += 1;
  }
  if (matched.length === 0) return;
  heap.length = write;
  for (let i = (write >> 1) - 1; i >= 0; i--) {
    bubbleDown(heap, i);
  }
  matched.sort((a, b) => (a.time === b.time ? a.seq - b.seq : a.time - b.time));
  for (const ev of matched) {
    handler(ev);
  }
}

/** Earliest scheduled event without mutating the heap. */
export function peek<T>(s: Scheduler<T>): ScheduledEvent<T> | undefined {
  return s.heap[0];
}

/**
 * Pop the earliest event and advance `now` to its time. Empty pop leaves
 * `now` unchanged and returns `undefined`.
 *
 * Stale payloads: `pop` always advances `now` to the popped event's `time`,
 * even when the caller decides to discard the event (e.g. its actor was
 * despawned). A chain of stale entries between two live events therefore
 * steps `now` through each intermediate stale time. That is the right
 * invariant for game-time (it advances regardless of who's alive); drain
 * loops must loop on `pop` + a liveness check rather than peeking.
 */
export function pop<T>(s: Scheduler<T>): ScheduledEvent<T> | undefined {
  const top = s.heap[0];
  if (top === undefined) return undefined;
  const last = s.heap.pop();
  if (s.heap.length > 0 && last !== undefined) {
    s.heap[0] = last;
    bubbleDown(s.heap, 0);
  }
  s.now = top.time;
  return top;
}

/** Number of events currently in the heap. */
export function size<T>(s: Scheduler<T>): number {
  return s.heap.length;
}
