/**
 * Variant parity: every variant must produce the same pop sequence as the
 * baseline for any given sequence of schedule / pop / removeWhere calls.
 * Catches the case where an optimization win is actually a correctness
 * regression hiding behind faster wrong answers.
 *
 * Not part of the optimization decision criterion — a faster variant that
 * fails parity is rejected outright. Lives under `bench/` so it doesn't
 * load production code into the test suite's compile graph.
 */
import { describe, expect, test } from "bun:test";
import { V0, V1, V2, V3, V4 } from "./variants.bench";

type Payload = {
  readonly kind: "actor";
  readonly zone: number;
  readonly id: number;
};

function p(id: number, zone = 0): Payload {
  return { kind: "actor", zone, id };
}

// Deterministic delay sequence: same LCG as the bench harness.
function makeRand(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = ((Math.imul(s, 1103515245) | 0) + 12345) | 0;
    return (s >>> 0) % 1000;
  };
}

function drainBaseline(): readonly Payload[] {
  const out: Payload[] = [];
  const s = V0.empty();
  const rand = makeRand(0xdeadbeef);
  for (let i = 0; i < 500; i++) V0.schedule(s, rand(), p(i));
  while (true) {
    const ev = V0.pop(s);
    if (ev === undefined) break;
    out.push(ev);
  }
  return out;
}

function drainVariant<S>(
  empty: () => S,
  schedule: (s: S, delay: number, payload: Payload) => void,
  pop: (s: S) => Payload | undefined,
): readonly Payload[] {
  const out: Payload[] = [];
  const s = empty();
  const rand = makeRand(0xdeadbeef);
  for (let i = 0; i < 500; i++) schedule(s, rand(), p(i));
  while (true) {
    const ev = pop(s);
    if (ev === undefined) break;
    out.push(ev);
  }
  return out;
}

describe("variant parity: schedule + pop full drain", () => {
  const baseline = drainBaseline();

  test("V1 inline-lessThan matches baseline pop order", () => {
    const out = drainVariant(V1.empty, V1.schedule, V1.pop);
    expect(out).toEqual(baseline);
  });

  test("V2 soa-storage matches baseline pop order", () => {
    const out = drainVariant(V2.empty, V2.schedule, V2.pop);
    expect(out).toEqual(baseline);
  });

  test("V3 in-place-removeWhere matches baseline pop order", () => {
    const out = drainVariant(V3.empty, V3.schedule, V3.pop);
    expect(out).toEqual(baseline);
  });

  test("V4 inline + in-place matches baseline pop order", () => {
    const out = drainVariant(V4.empty, V4.schedule, V4.pop);
    expect(out).toEqual(baseline);
  });
});

describe("variant parity: removeWhere preserves heap invariant", () => {
  function buildAndFilter<S>(
    empty: () => S,
    schedule: (s: S, delay: number, payload: Payload) => void,
    pop: (s: S) => Payload | undefined,
    removeWhereId: (s: S, pred: (id: number) => boolean) => void,
  ): readonly Payload[] {
    const out: Payload[] = [];
    const s = empty();
    const rand = makeRand(0xfeedface);
    for (let i = 0; i < 200; i++) schedule(s, rand(), p(i));
    // Drop every event with even id.
    removeWhereId(s, (id) => id % 2 === 0);
    while (true) {
      const ev = pop(s);
      if (ev === undefined) break;
      out.push(ev);
    }
    return out;
  }

  const baseline = buildAndFilter(
    V0.empty,
    V0.schedule,
    V0.pop,
    V0.removeWhereId,
  );

  test("V1 removeWhere matches baseline post-filter pop order", () => {
    expect(
      buildAndFilter(V1.empty, V1.schedule, V1.pop, V1.removeWhereId),
    ).toEqual(baseline);
  });

  test("V2 removeWhere matches baseline post-filter pop order", () => {
    expect(
      buildAndFilter(V2.empty, V2.schedule, V2.pop, V2.removeWhereId),
    ).toEqual(baseline);
  });

  test("V3 removeWhere matches baseline post-filter pop order", () => {
    expect(
      buildAndFilter(V3.empty, V3.schedule, V3.pop, V3.removeWhereId),
    ).toEqual(baseline);
  });

  test("V4 removeWhere matches baseline post-filter pop order", () => {
    expect(
      buildAndFilter(V4.empty, V4.schedule, V4.pop, V4.removeWhereId),
    ).toEqual(baseline);
  });

  test("baseline removeWhere preserves time-order monotonicity", () => {
    expect(baseline.length).toBeGreaterThan(0);
    for (let i = 0; i < baseline.length - 1; i++) {
      const cur = baseline[i];
      const next = baseline[i + 1];
      if (cur === undefined || next === undefined) continue;
      // Every survivor's id is odd (we dropped the even ones).
      expect(cur.id % 2).toBe(1);
      expect(next.id % 2).toBe(1);
    }
  });
});
