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

function lessThan<T>(a: ScheduledEvent<T>, b: ScheduledEvent<T>): boolean {
  if (a.time !== b.time) return a.time < b.time;
  return a.seq < b.seq;
}

function bubbleUp<T>(heap: ScheduledEvent<T>[], start: number): void {
  let i = start;
  while (i > 0) {
    const parent = (i - 1) >> 1;
    const cur = heap[i];
    const above = heap[parent];
    if (cur === undefined || above === undefined) return;
    if (!lessThan(cur, above)) return;
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
      if (lEv !== undefined && lessThan(lEv, bestEv)) {
        bestIdx = l;
        bestEv = lEv;
      }
    }
    if (r < n) {
      const rEv = heap[r];
      if (rEv !== undefined && lessThan(rEv, bestEv)) {
        bestIdx = r;
        bestEv = rEv;
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
