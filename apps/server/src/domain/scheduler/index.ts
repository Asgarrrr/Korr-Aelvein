/**
 * Turn-time scheduler — binary min-heap keyed on `(time, seq)`.
 *
 * One entry per future occurrence of an actor's turn. Faster actors
 * re-enter the heap with a smaller `delay`; slower ones with a larger
 * `delay`. Multi-action turns fall out for free: re-schedule the same
 * handle twice with small delays and it pops twice before another actor
 * gets a slot. Non-actor events (status expire, traps, scheduled
 * effects) will land here as additional discriminated arms when phase 3
 * needs them — the heap doesn't care what's queued, only when.
 *
 * Determinism contract: starting from `emptyScheduler()`, the sequence of
 * `schedule` / `pop` calls fully determines the popped event sequence.
 * Tie-break on equal `time` is the insertion-order `seq`, owned by the
 * scheduler itself — not derived from `World` column layout — so component
 * add/remove churn elsewhere cannot reorder turns.
 *
 * Mutation model: mirrors `World`. `Scheduler` is mutated in place; the
 * surrounding `GameState` wrapper rotates per tick.
 *
 * Stale entries: when an entity is despawned, scheduled events that still
 * reference its handle are skipped lazily on pop (caller checks
 * `isLiveHandle`). Eager removal would be O(n) in a binary heap and isn't
 * worth it at our entity scale.
 */

import type { EntityHandle } from "../ecs/index";

/** A future occurrence on the timeline. */
export type ScheduledEvent = {
  /** Absolute tick at which this event fires. */
  readonly time: number;
  /** Insertion order — breaks `time` ties deterministically (FIFO). */
  readonly seq: number;
  /** Whose turn it is. */
  readonly handle: EntityHandle;
};

/**
 * Mutable scheduler state. `heap` is a binary min-heap in array form:
 * children of `i` are at `2i+1` and `2i+2`; parent is at `(i-1) >> 1`.
 */
export type Scheduler = {
  heap: ScheduledEvent[];
  /** Last popped event's time. 0 when nothing has been popped yet. */
  now: number;
  /** Next `seq` to hand out. Monotonic; never resets. */
  nextSeq: number;
};

export function emptyScheduler(): Scheduler {
  return { heap: [], now: 0, nextSeq: 0 };
}

function lessThan(a: ScheduledEvent, b: ScheduledEvent): boolean {
  if (a.time !== b.time) return a.time < b.time;
  return a.seq < b.seq;
}

function bubbleUp(heap: ScheduledEvent[], start: number): void {
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

function bubbleDown(heap: ScheduledEvent[], start: number): void {
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
 * Schedule `handle` to act at `now + delay`. `delay` must be a non-negative
 * integer — internal callers only, no runtime check (boundary-only validation
 * per project rules; floats would let cross-engine FP drift leak into the
 * queue order, negative values would let events fire in the past).
 */
export function schedule(
  s: Scheduler,
  delay: number,
  handle: EntityHandle,
): void {
  const ev: ScheduledEvent = {
    time: s.now + delay,
    seq: s.nextSeq,
    handle,
  };
  s.nextSeq += 1;
  s.heap.push(ev);
  bubbleUp(s.heap, s.heap.length - 1);
}

/** Earliest scheduled event without mutating the heap. */
export function peek(s: Scheduler): ScheduledEvent | undefined {
  return s.heap[0];
}

/**
 * Pop the earliest event and advance `now` to its time. Empty pop leaves
 * `now` unchanged and returns `undefined`.
 *
 * Stale handles: `pop` always advances `now` to the popped event's `time`,
 * even when the caller decides to discard the event because its handle is
 * dead. A chain of stale entries between two live events therefore steps
 * `now` through each intermediate stale time. That is the right invariant
 * for game-time (it advances regardless of who's alive), but phase-2
 * authors writing the AI drain need to know they should loop:
 * `while (peek live ? false : pop && isLiveHandle(...))`.
 */
export function pop(s: Scheduler): ScheduledEvent | undefined {
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
export function size(s: Scheduler): number {
  return s.heap.length;
}
