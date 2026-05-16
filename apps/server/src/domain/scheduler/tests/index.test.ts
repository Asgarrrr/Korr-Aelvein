import { describe, expect, test } from "bun:test";
import type { EntityHandle } from "../../ecs/index";
import {
  drainWhere,
  emptyScheduler,
  peek,
  pop,
  removeWhere,
  type ScheduledEvent,
  schedule,
  scheduleAt,
  size,
} from "../index";

function h(id: number, gen = 0): EntityHandle {
  return { id, gen };
}

describe("scheduler — empty state", () => {
  test("peek and pop both return undefined on an empty scheduler", () => {
    const s = emptyScheduler<EntityHandle>();
    expect(peek(s)).toBeUndefined();
    expect(pop(s)).toBeUndefined();
    expect(size(s)).toBe(0);
    expect(s.now).toBe(0);
  });

  test("pop on empty does not advance now", () => {
    const s = emptyScheduler<EntityHandle>();
    pop(s);
    expect(s.now).toBe(0);
  });
});

describe("scheduler — basic ordering", () => {
  test("single event: peek returns it without mutation, pop advances now", () => {
    const s = emptyScheduler<EntityHandle>();
    schedule(s, 42, h(1));
    const seen = peek(s);
    expect(seen?.payload).toEqual(h(1));
    expect(seen?.time).toBe(42);
    expect(size(s)).toBe(1);
    expect(s.now).toBe(0);

    const popped = pop(s);
    expect(popped?.payload).toEqual(h(1));
    expect(s.now).toBe(42);
    expect(size(s)).toBe(0);
  });

  test("two events: earliest time pops first", () => {
    const s = emptyScheduler<EntityHandle>();
    schedule(s, 100, h(1));
    schedule(s, 50, h(2));
    expect(pop(s)?.payload).toEqual(h(2));
    expect(s.now).toBe(50);
    expect(pop(s)?.payload).toEqual(h(1));
    expect(s.now).toBe(100);
  });

  test("delay 0 schedules at the current `now`", () => {
    const s = emptyScheduler<EntityHandle>();
    schedule(s, 0, h(1));
    expect(peek(s)?.time).toBe(0);

    pop(s); // now=0, still
    expect(s.now).toBe(0);
    schedule(s, 0, h(2));
    expect(peek(s)?.time).toBe(0);
  });
});

describe("scheduler — FIFO tiebreak via seq", () => {
  test("equal times pop in insertion order", () => {
    const s = emptyScheduler<EntityHandle>();
    schedule(s, 10, h(1));
    schedule(s, 10, h(2));
    schedule(s, 10, h(3));
    expect(pop(s)?.payload).toEqual(h(1));
    expect(pop(s)?.payload).toEqual(h(2));
    expect(pop(s)?.payload).toEqual(h(3));
  });

  test("interleaved schedule/pop still respects FIFO for ties", () => {
    const s = emptyScheduler<EntityHandle>();
    schedule(s, 10, h(1)); // seq 0
    schedule(s, 5, h(2)); // seq 1
    schedule(s, 10, h(3)); // seq 2 — same time as h(1), inserted after
    expect(pop(s)?.payload).toEqual(h(2));
    expect(pop(s)?.payload).toEqual(h(1));
    expect(pop(s)?.payload).toEqual(h(3));
  });

  test("seq monotonically increases and never resets", () => {
    const s = emptyScheduler<EntityHandle>();
    schedule(s, 10, h(1));
    schedule(s, 10, h(2));
    pop(s);
    pop(s);
    expect(s.nextSeq).toBe(2);
    schedule(s, 10, h(3));
    // After the two pops, next event still gets seq=2.
    expect(peek(s)?.seq).toBe(2);
    expect(s.nextSeq).toBe(3);
  });
});

describe("scheduler — multi-action per turn", () => {
  test("scheduling the same handle multiple times pops it multiple times", () => {
    const s = emptyScheduler<EntityHandle>();
    schedule(s, 100, h(1));
    schedule(s, 110, h(1)); // second action a hair later
    schedule(s, 105, h(2)); // another actor interleaved
    expect(pop(s)?.payload).toEqual(h(1));
    expect(pop(s)?.payload).toEqual(h(2));
    expect(pop(s)?.payload).toEqual(h(1));
  });
});

describe("scheduler — stress", () => {
  test("100 random delays pop in monotonic non-decreasing time order", () => {
    const s = emptyScheduler<EntityHandle>();
    // Fixed-seed pseudo-random to keep the test deterministic. We do not
    // pull `Rng` here — keeping this module's tests free of cross-module
    // deps and using a tiny inlined LCG for repeatability.
    let lcg = 0xdeadbeef;
    const rand = (): number => {
      lcg = (lcg * 1103515245 + 12345) & 0x7fffffff;
      return lcg;
    };
    for (let i = 0; i < 100; i++) {
      schedule(s, rand() % 1000, h(i));
    }
    let prev = -1;
    let count = 0;
    while (true) {
      const ev = pop(s);
      if (ev === undefined) break;
      expect(ev.time).toBeGreaterThanOrEqual(prev);
      prev = ev.time;
      count += 1;
    }
    expect(count).toBe(100);
  });

  test("two identical operation sequences produce identical pop sequences", () => {
    function run(): Array<{ time: number; handle: EntityHandle }> {
      const s = emptyScheduler<EntityHandle>();
      let lcg = 12345;
      const rand = (): number => {
        lcg = (lcg * 1103515245 + 12345) & 0x7fffffff;
        return lcg;
      };
      for (let i = 0; i < 50; i++) {
        schedule(s, rand() % 500, h(i));
      }
      const out: Array<{ time: number; handle: EntityHandle }> = [];
      while (true) {
        const ev = pop(s);
        if (ev === undefined) break;
        out.push({ time: ev.time, handle: ev.payload });
      }
      return out;
    }
    expect(run()).toEqual(run());
  });
});

describe("scheduler — `now` semantics", () => {
  test("now advances to popped event's time, never backwards", () => {
    const s = emptyScheduler<EntityHandle>();
    schedule(s, 50, h(1));
    schedule(s, 100, h(2));
    pop(s);
    expect(s.now).toBe(50);
    pop(s);
    expect(s.now).toBe(100);
  });

  test("scheduling further uses the current now as base", () => {
    const s = emptyScheduler<EntityHandle>();
    schedule(s, 50, h(1));
    pop(s); // now = 50
    schedule(s, 10, h(2));
    // h(2) should be at time 60, not 10.
    expect(peek(s)?.time).toBe(60);
  });
});

describe("scheduler — scheduleAt (absolute time)", () => {
  test("schedules at the requested absolute time, ignoring delay arithmetic", () => {
    const s = emptyScheduler<EntityHandle>();
    schedule(s, 30, h(1));
    pop(s); // now = 30
    scheduleAt(s, 100, h(2));
    expect(peek(s)?.time).toBe(100);
  });

  test("equal-time tiebreak is FIFO across schedule and scheduleAt mixed", () => {
    const s = emptyScheduler<EntityHandle>();
    schedule(s, 50, h(1)); // seq 0, time 50
    scheduleAt(s, 50, h(2)); // seq 1, time 50
    schedule(s, 50, h(3)); // seq 2, time 50
    expect(pop(s)?.payload).toEqual(h(1));
    expect(pop(s)?.payload).toEqual(h(2));
    expect(pop(s)?.payload).toEqual(h(3));
  });

  test("scheduleAt at exactly now is permitted (fires this turn)", () => {
    const s = emptyScheduler<EntityHandle>();
    schedule(s, 50, h(1));
    pop(s); // now = 50
    scheduleAt(s, 50, h(2));
    expect(peek(s)?.time).toBe(50);
  });

  test("scheduleAt in the past throws", () => {
    const s = emptyScheduler<EntityHandle>();
    schedule(s, 100, h(1));
    pop(s); // now = 100
    expect(() => scheduleAt(s, 50, h(2))).toThrow(/past/);
  });

  test("scheduleAt consumes a fresh seq even on the same time as a prior event", () => {
    const s = emptyScheduler<EntityHandle>();
    scheduleAt(s, 10, h(1));
    expect(s.nextSeq).toBe(1);
    scheduleAt(s, 10, h(2));
    expect(s.nextSeq).toBe(2);
  });
});

describe("scheduler — removeWhere", () => {
  test("removes every matching event, keeps non-matching", () => {
    const s = emptyScheduler<EntityHandle>();
    schedule(s, 10, h(1));
    schedule(s, 20, h(2));
    schedule(s, 30, h(3));
    schedule(s, 40, h(4));
    removeWhere(s, (ev) => ev.payload.id % 2 === 0);
    expect(size(s)).toBe(2);
    expect(pop(s)?.payload).toEqual(h(1));
    expect(pop(s)?.payload).toEqual(h(3));
    expect(pop(s)).toBeUndefined();
  });

  test("removeWhere preserves heap order for survivors", () => {
    const s = emptyScheduler<EntityHandle>();
    // Insert in non-monotonic order so a naive "keep array order" approach
    // would corrupt the heap.
    const inserts: ReadonlyArray<readonly [number, number]> = [
      [100, 1],
      [10, 2],
      [50, 3],
      [5, 4],
      [200, 5],
      [25, 6],
    ];
    for (const [delay, id] of inserts) {
      schedule(s, delay, h(id));
    }
    // Drop entities 2 and 5.
    removeWhere(s, (ev) => ev.payload.id === 2 || ev.payload.id === 5);
    const order: number[] = [];
    while (true) {
      const ev = pop(s);
      if (ev === undefined) break;
      order.push(ev.time);
    }
    expect(order).toEqual([5, 25, 50, 100]);
  });

  test("removeWhere on empty heap is a no-op", () => {
    const s = emptyScheduler<EntityHandle>();
    removeWhere(s, () => true);
    expect(size(s)).toBe(0);
  });

  test("removeWhere matching nothing leaves the heap intact", () => {
    const s = emptyScheduler<EntityHandle>();
    schedule(s, 10, h(1));
    schedule(s, 20, h(2));
    removeWhere(s, () => false);
    expect(pop(s)?.payload).toEqual(h(1));
    expect(pop(s)?.payload).toEqual(h(2));
  });

  test("removeWhere does not reset seq counter — future events keep monotonic seq", () => {
    const s = emptyScheduler<EntityHandle>();
    schedule(s, 10, h(1)); // seq 0
    schedule(s, 20, h(2)); // seq 1
    removeWhere(s, (ev) => ev.payload.id === 1);
    expect(s.nextSeq).toBe(2);
    schedule(s, 30, h(3)); // seq 2
    pop(s); // h(2), seq 1
    expect(peek(s)?.seq).toBe(2);
  });
});

describe("scheduler — drainWhere", () => {
  test("hands every matching event to the handler in (time, seq) order", () => {
    const s = emptyScheduler<EntityHandle>();
    schedule(s, 30, h(1)); // seq 0
    schedule(s, 10, h(2)); // seq 1
    schedule(s, 20, h(3)); // seq 2
    schedule(s, 10, h(4)); // seq 3
    const seen: ScheduledEvent<EntityHandle>[] = [];
    drainWhere(
      s,
      (ev) => ev.payload.id !== 3,
      (ev) => seen.push(ev),
    );
    expect(seen.map((ev) => ev.payload.id)).toEqual([2, 4, 1]);
    // Only the non-matching event survives.
    expect(size(s)).toBe(1);
    expect(pop(s)?.payload).toEqual(h(3));
  });

  test("preserves heap order for survivors", () => {
    const s = emptyScheduler<EntityHandle>();
    const inserts: ReadonlyArray<readonly [number, number]> = [
      [100, 1],
      [10, 2],
      [50, 3],
      [5, 4],
      [200, 5],
      [25, 6],
    ];
    for (const [delay, id] of inserts) {
      schedule(s, delay, h(id));
    }
    drainWhere(
      s,
      (ev) => ev.payload.id === 2 || ev.payload.id === 5,
      () => {},
    );
    const order: number[] = [];
    while (true) {
      const ev = pop(s);
      if (ev === undefined) break;
      order.push(ev.time);
    }
    expect(order).toEqual([5, 25, 50, 100]);
  });

  test("empty heap is a no-op (handler never called)", () => {
    const s = emptyScheduler<EntityHandle>();
    let calls = 0;
    drainWhere(
      s,
      () => true,
      () => {
        calls += 1;
      },
    );
    expect(calls).toBe(0);
    expect(size(s)).toBe(0);
  });

  test("matching nothing leaves the heap intact and never calls the handler", () => {
    const s = emptyScheduler<EntityHandle>();
    schedule(s, 10, h(1));
    schedule(s, 20, h(2));
    let calls = 0;
    drainWhere(
      s,
      () => false,
      () => {
        calls += 1;
      },
    );
    expect(calls).toBe(0);
    expect(pop(s)?.payload).toEqual(h(1));
    expect(pop(s)?.payload).toEqual(h(2));
  });

  test("no-match call leaves the heap byte-identical (seq order, slot order, size)", () => {
    // Locks the contract: when the predicate matches nothing, the compact
    // loop performs identity writes, `heap.length` is untouched, and no
    // Floyd heapify runs. Determinism contract for replay relies on this.
    const s = emptyScheduler<EntityHandle>();
    const inserts: ReadonlyArray<readonly [number, number]> = [
      [100, 1],
      [10, 2],
      [50, 3],
      [5, 4],
      [200, 5],
      [25, 6],
    ];
    for (const [delay, id] of inserts) {
      schedule(s, delay, h(id));
    }
    const snapshot = s.heap.map((ev) => ({
      time: ev.time,
      seq: ev.seq,
      id: ev.payload.id,
    }));
    drainWhere(
      s,
      () => false,
      () => {},
    );
    const after = s.heap.map((ev) => ({
      time: ev.time,
      seq: ev.seq,
      id: ev.payload.id,
    }));
    expect(after).toEqual(snapshot);
    expect(s.heap.length).toBe(inserts.length);
  });

  test("does not advance `now` (parallel with removeWhere)", () => {
    const s = emptyScheduler<EntityHandle>();
    schedule(s, 50, h(1));
    schedule(s, 100, h(2));
    drainWhere(
      s,
      (ev) => ev.payload.id === 1,
      () => {},
    );
    expect(s.now).toBe(0);
  });

  test("does not reset seq counter — future events keep monotonic seq", () => {
    const s = emptyScheduler<EntityHandle>();
    schedule(s, 10, h(1)); // seq 0
    schedule(s, 20, h(2)); // seq 1
    drainWhere(
      s,
      (ev) => ev.payload.id === 1,
      () => {},
    );
    expect(s.nextSeq).toBe(2);
    schedule(s, 30, h(3)); // seq 2
    pop(s); // h(2), seq 1
    expect(peek(s)?.seq).toBe(2);
  });

  test("handler order matches the order a normal pop chain would produce", () => {
    const s = emptyScheduler<EntityHandle>();
    schedule(s, 10, h(1)); // seq 0
    schedule(s, 10, h(2)); // seq 1
    schedule(s, 10, h(3)); // seq 2
    schedule(s, 20, h(4)); // seq 3
    const drained: number[] = [];
    drainWhere(
      s,
      () => true,
      (ev) => drained.push(ev.payload.id),
    );
    expect(drained).toEqual([1, 2, 3, 4]);
    expect(size(s)).toBe(0);
  });
});
