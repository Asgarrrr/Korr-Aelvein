import { describe, expect, test } from "bun:test";
import {
  defineEvent,
  drain,
  emit,
  emptyWorld,
  restore,
  snapshot,
} from "../index";

describe("EventBus", () => {
  test("emit then drain yields events in emit order", () => {
    const w = emptyWorld();
    const hit = defineEvent<{ damage: number }>("hit");
    emit(w, hit, { damage: 5 });
    emit(w, hit, { damage: 3 });
    emit(w, hit, { damage: 7 });
    expect(drain(w, hit)).toEqual([
      { damage: 5 },
      { damage: 3 },
      { damage: 7 },
    ]);
  });

  test("drain clears the bucket (second drain is empty)", () => {
    const w = emptyWorld();
    const hit = defineEvent<{ damage: number }>("hit");
    emit(w, hit, { damage: 1 });
    expect(drain(w, hit).length).toBe(1);
    expect(drain(w, hit)).toEqual([]);
  });

  test("drain on a never-emitted channel is empty", () => {
    const w = emptyWorld();
    const death = defineEvent<{ killerId: number }>("death");
    expect(drain(w, death)).toEqual([]);
  });

  test("distinct channels do not cross-pollute", () => {
    const w = emptyWorld();
    const hit = defineEvent<{ damage: number }>("hit");
    const death = defineEvent<{ killerId: number }>("death");
    emit(w, hit, { damage: 10 });
    emit(w, death, { killerId: 7 });
    emit(w, hit, { damage: 20 });
    expect(drain(w, hit)).toEqual([{ damage: 10 }, { damage: 20 }]);
    expect(drain(w, death)).toEqual([{ killerId: 7 }]);
  });

  test("emptyWorld has no channels", () => {
    const w = emptyWorld();
    expect(w.events.size).toBe(0);
  });

  // After drain, the Map entry must be removed. Without this, dynamic channel
  // names (`defineEvent("hit_" + entityId)`) would accumulate empty buckets
  // forever and bloat snapshots monotonically.
  test("drain deletes the Map entry (no bucket-name accumulation)", () => {
    const w = emptyWorld();
    const hit = defineEvent<{ damage: number }>("hit");
    emit(w, hit, { damage: 5 });
    expect(w.events.size).toBe(1);
    drain(w, hit);
    expect(w.events.size).toBe(0);
  });

  // Snapshot must drop empty buckets — drained channels should NOT show up
  // in `s.events` even if the Map entry somehow lingered.
  test("snapshot drops empty buckets from the serialized events list", () => {
    const w = emptyWorld();
    const hit = defineEvent<{ damage: number }>("hit");
    emit(w, hit, { damage: 5 });
    drain(w, hit);
    const s = snapshot(w);
    expect(s.events).toEqual([]);
  });

  test("snapshot + restore preserves un-drained events", () => {
    const w = emptyWorld();
    const hit = defineEvent<{ damage: number }>("hit");
    const death = defineEvent<{ killerId: number }>("death");
    emit(w, hit, { damage: 5 });
    emit(w, hit, { damage: 3 });
    emit(w, death, { killerId: 1 });

    const s = snapshot(w);
    const w2 = restore(s);

    expect(drain(w2, hit)).toEqual([{ damage: 5 }, { damage: 3 }]);
    expect(drain(w2, death)).toEqual([{ killerId: 1 }]);
  });

  test("snapshot after drain has empty channel buckets", () => {
    const w = emptyWorld();
    const hit = defineEvent<{ damage: number }>("hit");
    emit(w, hit, { damage: 5 });
    drain(w, hit);
    const s = snapshot(w);
    const w2 = restore(s);
    expect(drain(w2, hit)).toEqual([]);
  });

  test("drain returns a fresh array (caller can mutate freely)", () => {
    const w = emptyWorld();
    const hit = defineEvent<{ damage: number }>("hit");
    emit(w, hit, { damage: 5 });
    const out = drain(w, hit);
    out.length = 0; // caller-side mutation
    // Next emit + drain returns the new event, untouched by the previous drain.
    emit(w, hit, { damage: 7 });
    expect(drain(w, hit)).toEqual([{ damage: 7 }]);
  });

  test("emitting on the same channel name from two defineEvent calls shares the bucket", () => {
    // The channel identity is its name, not the typed handle. Two
    // defineEvent("x") calls of the SAME T share state — useful pattern for
    // cross-module shared channels, dangerous if T differs (the typed
    // boundary guarantees T at the call site but not across modules).
    const w = emptyWorld();
    const a = defineEvent<{ v: number }>("shared");
    const b = defineEvent<{ v: number }>("shared");
    emit(w, a, { v: 1 });
    emit(w, b, { v: 2 });
    expect(drain(w, a)).toEqual([{ v: 1 }, { v: 2 }]);
    expect(drain(w, b)).toEqual([]);
  });
});
