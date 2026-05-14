import { describe, expect, test } from "bun:test";
import type { EntityHandle } from "../../ecs/index";
import { emptyScheduler, peek, pop, schedule, size } from "../index";

function h(id: number, gen = 0): EntityHandle {
  return { id, gen };
}

describe("scheduler — empty state", () => {
  test("peek and pop both return undefined on an empty scheduler", () => {
    const s = emptyScheduler();
    expect(peek(s)).toBeUndefined();
    expect(pop(s)).toBeUndefined();
    expect(size(s)).toBe(0);
    expect(s.now).toBe(0);
  });

  test("pop on empty does not advance now", () => {
    const s = emptyScheduler();
    pop(s);
    expect(s.now).toBe(0);
  });
});

describe("scheduler — basic ordering", () => {
  test("single event: peek returns it without mutation, pop advances now", () => {
    const s = emptyScheduler();
    schedule(s, 42, h(1));
    const seen = peek(s);
    expect(seen?.handle).toEqual(h(1));
    expect(seen?.time).toBe(42);
    expect(size(s)).toBe(1);
    expect(s.now).toBe(0);

    const popped = pop(s);
    expect(popped?.handle).toEqual(h(1));
    expect(s.now).toBe(42);
    expect(size(s)).toBe(0);
  });

  test("two events: earliest time pops first", () => {
    const s = emptyScheduler();
    schedule(s, 100, h(1));
    schedule(s, 50, h(2));
    expect(pop(s)?.handle).toEqual(h(2));
    expect(s.now).toBe(50);
    expect(pop(s)?.handle).toEqual(h(1));
    expect(s.now).toBe(100);
  });

  test("delay 0 schedules at the current `now`", () => {
    const s = emptyScheduler();
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
    const s = emptyScheduler();
    schedule(s, 10, h(1));
    schedule(s, 10, h(2));
    schedule(s, 10, h(3));
    expect(pop(s)?.handle).toEqual(h(1));
    expect(pop(s)?.handle).toEqual(h(2));
    expect(pop(s)?.handle).toEqual(h(3));
  });

  test("interleaved schedule/pop still respects FIFO for ties", () => {
    const s = emptyScheduler();
    schedule(s, 10, h(1)); // seq 0
    schedule(s, 5, h(2)); // seq 1
    schedule(s, 10, h(3)); // seq 2 — same time as h(1), inserted after
    expect(pop(s)?.handle).toEqual(h(2));
    expect(pop(s)?.handle).toEqual(h(1));
    expect(pop(s)?.handle).toEqual(h(3));
  });

  test("seq monotonically increases and never resets", () => {
    const s = emptyScheduler();
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
    const s = emptyScheduler();
    schedule(s, 100, h(1));
    schedule(s, 110, h(1)); // second action a hair later
    schedule(s, 105, h(2)); // another actor interleaved
    expect(pop(s)?.handle).toEqual(h(1));
    expect(pop(s)?.handle).toEqual(h(2));
    expect(pop(s)?.handle).toEqual(h(1));
  });
});

describe("scheduler — stress", () => {
  test("100 random delays pop in monotonic non-decreasing time order", () => {
    const s = emptyScheduler();
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
      const s = emptyScheduler();
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
        out.push({ time: ev.time, handle: ev.handle });
      }
      return out;
    }
    expect(run()).toEqual(run());
  });
});

describe("scheduler — `now` semantics", () => {
  test("now advances to popped event's time, never backwards", () => {
    const s = emptyScheduler();
    schedule(s, 50, h(1));
    schedule(s, 100, h(2));
    pop(s);
    expect(s.now).toBe(50);
    pop(s);
    expect(s.now).toBe(100);
  });

  test("scheduling further uses the current now as base", () => {
    const s = emptyScheduler();
    schedule(s, 50, h(1));
    pop(s); // now = 50
    schedule(s, 10, h(2));
    // h(2) should be at time 60, not 10.
    expect(peek(s)?.time).toBe(60);
  });
});
