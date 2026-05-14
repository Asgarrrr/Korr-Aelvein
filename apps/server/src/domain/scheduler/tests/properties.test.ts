// Adversarial cross-check: drives the real scheduler and a naive
// sorted-array reference with the same randomised schedule/pop sequence
// and asserts they produce identical pop streams. Catches any future
// regression in bubble-up / bubble-down / tie-break logic.

import { describe, expect, test } from "bun:test";
import type { EntityHandle } from "../../ecs/index";
import {
  emptyScheduler,
  peek,
  pop,
  type ScheduledEvent,
  type Scheduler,
  schedule,
  size,
} from "../index";

function h(id: number, gen = 0): EntityHandle {
  return { id, gen };
}

// Naive reference: keep events sorted by (time, seq) ascending. Always
// correct, never fast. Mirrors `Scheduler` semantics.
type Ref = {
  list: ScheduledEvent[];
  now: number;
  nextSeq: number;
};

function refEmpty(): Ref {
  return { list: [], now: 0, nextSeq: 0 };
}

function refSchedule(r: Ref, delay: number, handle: EntityHandle): void {
  const ev: ScheduledEvent = {
    time: r.now + delay,
    seq: r.nextSeq,
    handle,
  };
  r.nextSeq += 1;
  let insertAt = r.list.length;
  for (const [i, cur] of r.list.entries()) {
    if (cur.time > ev.time || (cur.time === ev.time && cur.seq > ev.seq)) {
      insertAt = i;
      break;
    }
  }
  r.list.splice(insertAt, 0, ev);
}

function refPop(r: Ref): ScheduledEvent | undefined {
  const head = r.list.shift();
  if (head === undefined) return undefined;
  r.now = head.time;
  return head;
}

// Returns -1 if the binary min-heap property holds, otherwise the child
// index that violates it relative to its parent. Throws if it encounters
// a hole in the heap — `Scheduler.heap` is typed `ScheduledEvent[]` so a
// hole is a real bug worth surfacing loudly, not a "no violation found".
function findHeapViolation(s: Scheduler): number {
  const heap = s.heap;
  for (const [i, cur] of heap.entries()) {
    if (cur === undefined) {
      throw new Error(`heap contains undefined slot at index ${i}`);
    }
    const l = 2 * i + 1;
    const r = 2 * i + 2;
    if (l < heap.length) {
      const lv = heap[l];
      if (lv !== undefined) {
        if (lv.time < cur.time) return l;
        if (lv.time === cur.time && lv.seq < cur.seq) return l;
      }
    }
    if (r < heap.length) {
      const rv = heap[r];
      if (rv !== undefined) {
        if (rv.time < cur.time) return r;
        if (rv.time === cur.time && rv.seq < cur.seq) return r;
      }
    }
  }
  return -1;
}

function makeLcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s;
  };
}

function runCrossCheck(seed: number, steps: number, delayMod: number): void {
  const real = emptyScheduler();
  const ref = refEmpty();
  const rand = makeLcg(seed);
  let scheduled = 0;

  for (let step = 0; step < steps; step++) {
    // 50/30/20 sched/pop/peek so pop-on-empty and peek both get exercised
    // without the test driver branching on the heap's current size.
    const roll = rand() % 100;
    if (roll < 50) {
      const delay = rand() % delayMod;
      const handle = h(scheduled);
      scheduled += 1;
      schedule(real, delay, handle);
      refSchedule(ref, delay, handle);
      // `seq` counters must remain in lockstep — a future bug double-bumping
      // either side would skew tiebreaks without changing pop ordering.
      expect(real.nextSeq).toBe(ref.nextSeq);
    } else if (roll < 80) {
      const nowBefore = real.now;
      const realEv = pop(real);
      const refEv = refPop(ref);
      expect(realEv).toEqual(refEv);
      if (realEv === undefined) {
        // Pop on empty must not touch `now`.
        expect(real.now).toBe(nowBefore);
      } else {
        expect(real.now).toBe(ref.now);
      }
    } else {
      const nowBefore = real.now;
      const sizeBefore = size(real);
      const peeked = peek(real);
      expect(peeked).toEqual(ref.list[0]);
      // Peek must be a pure read.
      expect(real.now).toBe(nowBefore);
      expect(size(real)).toBe(sizeBefore);
    }
    expect(findHeapViolation(real)).toBe(-1);
    expect(size(real)).toBe(ref.list.length);
    expect(real.nextSeq).toBe(ref.nextSeq);
  }
  while (size(real) > 0) {
    expect(pop(real)).toEqual(refPop(ref));
  }
}

describe("scheduler — property tests vs sorted-array reference", () => {
  test("5000 mixed ops with wide delays match the reference exactly", () => {
    runCrossCheck(0xc0ffee, 5000, 500);
  });

  test("2000 mixed ops with narrow delays (heavy ties) match the reference", () => {
    runCrossCheck(42, 2000, 3);
  });

  test("schedule N then drain N reproduces (time, seq) sorted order", () => {
    const s = emptyScheduler();
    const rand = makeLcg(0xdeadbeef);
    const N = 1000;
    const inserted: Array<{ time: number; seq: number; id: number }> = [];
    for (let i = 0; i < N; i++) {
      const delay = rand() % 1_000_000;
      schedule(s, delay, h(i));
      expect(findHeapViolation(s)).toBe(-1);
      inserted.push({ time: delay, seq: i, id: i });
    }
    const popped: Array<{ time: number; seq: number; id: number }> = [];
    while (size(s) > 0) {
      const e = pop(s);
      // size > 0 implies pop returns a defined event; an undefined here
      // means `pop` broke its contract — fail loud, don't silently truncate.
      if (e === undefined) {
        throw new Error("pop returned undefined while size > 0");
      }
      popped.push({ time: e.time, seq: e.seq, id: e.handle.id });
      expect(findHeapViolation(s)).toBe(-1);
    }
    inserted.sort((a, b) =>
      a.time !== b.time ? a.time - b.time : a.seq - b.seq,
    );
    expect(popped).toEqual(inserted);
  });

  test("pure tiebreak: 1000 events at delay 0 pop in strict seq order", () => {
    // The only configuration where every comparison falls through to the seq
    // tiebreak — wide-delay tests bury this path under time variation.
    const s = emptyScheduler();
    const N = 1000;
    for (let i = 0; i < N; i++) {
      schedule(s, 0, h(i));
      expect(findHeapViolation(s)).toBe(-1);
    }
    for (let i = 0; i < N; i++) {
      const e = pop(s);
      if (e === undefined) {
        throw new Error(`pop returned undefined at i=${i} while size > 0`);
      }
      expect(e.handle.id).toBe(i);
      expect(e.seq).toBe(i);
      expect(e.time).toBe(0);
    }
    expect(size(s)).toBe(0);
  });
});
