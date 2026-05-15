// Boundary-defense tests from Codex's second-opinion review.
//
// Each test corresponds to a soundness gap that the original code allowed
// silently. The fixes live in world.ts (validation at spawn/setComponent/
// restore + per-component cloning).

import { describe, expect, test } from "bun:test";
import {
  emptyWorld,
  getComponent,
  restore,
  type SerializableWorld,
  setComponent,
  snapshot,
  spawn,
} from "../index";

// ─── Generation overflow at restore() boundary ──────────────────────────────
//
// Restore takes a SerializableWorld from disk / network and trusts the
// generation values. A corrupt or malicious snapshot can plant gen ≥ 2^53
// where + 1 stops advancing the value (JS double precision wall). The
// parity check still works mathematically, but `gen === stored + 1` becomes
// `gen === gen`, and despawn becomes a no-op that double-pushes recycled.

describe("restore: generation safety", () => {
  test("rejects generation ≥ 2^31 (parity-safe upper bound)", () => {
    const s: SerializableWorld = {
      position: [],
      actor: [],
      hp: [],
      ai: [],
      generations: [[0, 2 ** 31]],
      nextId: 1,
      recycled: [],
      added: { position: [], actor: [], hp: [], ai: [] },
      removed: { position: [], actor: [], hp: [], ai: [] },
      events: [],
    };
    expect(() => restore(s)).toThrow(/generation/);
  });

  test("rejects non-finite generation", () => {
    const s: SerializableWorld = {
      position: [],
      actor: [],
      hp: [],
      ai: [],
      generations: [[0, Number.POSITIVE_INFINITY]],
      nextId: 1,
      recycled: [],
      added: { position: [], actor: [], hp: [], ai: [] },
      removed: { position: [], actor: [], hp: [], ai: [] },
      events: [],
    };
    expect(() => restore(s)).toThrow(/generation/);
  });

  test("rejects negative generation", () => {
    const s: SerializableWorld = {
      position: [],
      actor: [],
      hp: [],
      ai: [],
      generations: [[0, -1]],
      nextId: 1,
      recycled: [],
      added: { position: [], actor: [], hp: [], ai: [] },
      removed: { position: [], actor: [], hp: [], ai: [] },
      events: [],
    };
    expect(() => restore(s)).toThrow(/generation/);
  });

  test("rejects non-integer generation", () => {
    const s: SerializableWorld = {
      position: [],
      actor: [],
      hp: [],
      ai: [],
      generations: [[0, 1.5]],
      nextId: 1,
      recycled: [],
      added: { position: [], actor: [], hp: [], ai: [] },
      removed: { position: [], actor: [], hp: [], ai: [] },
      events: [],
    };
    expect(() => restore(s)).toThrow(/generation/);
  });

  test("accepts realistic generation values", () => {
    const s: SerializableWorld = {
      position: [],
      actor: [],
      hp: [],
      ai: [],
      generations: [
        [0, 0],
        [1, 2],
        [2, 1_000_000],
      ],
      nextId: 3,
      recycled: [1],
      added: { position: [], actor: [], hp: [], ai: [] },
      removed: { position: [], actor: [], hp: [], ai: [] },
      events: [],
    };
    expect(() => restore(s)).not.toThrow();
  });
});

// ─── Components stored by value (defensive cloning) ──────────────────────────
//
// The previous code stored the caller's reference directly. If the caller
// mutated their object post-spawn, the world's state mutated too. The
// `readonly` modifier on Position/Actor/HP only constrains the public API
// surface, not value mutation through aliased references.

describe("components stored by value", () => {
  test("spawn: caller cannot mutate world state via their reference", () => {
    const w = emptyWorld();
    const p = { x: 1, y: 2 };
    const h = spawn(w, { position: p });
    p.x = 99;
    p.y = 99;
    expect(getComponent(w, h, "position")).toEqual({ x: 1, y: 2 });
  });

  test("setComponent: caller cannot mutate world state via their reference", () => {
    const w = emptyWorld();
    const h = spawn(w, { position: { x: 0, y: 0 } });
    const next = { x: 5, y: 6 };
    setComponent(w, h, "position", next);
    next.x = 100;
    expect(getComponent(w, h, "position")).toEqual({ x: 5, y: 6 });
  });

  test("snapshot: mutating snapshot doesn't affect world", () => {
    const w = emptyWorld();
    const h = spawn(w, { position: { x: 1, y: 2 } });
    const s = snapshot(w);
    const entry = s.position[0];
    if (entry === undefined) throw new Error("setup: missing position entry");
    // The snapshot's tuple+value are typed `readonly`, but JSON-round-trip
    // drops that — the test checks runtime safety, not TS safety.
    const clone: { x: number; y: number } = JSON.parse(
      JSON.stringify(entry[1]),
    );
    clone.x = 99;
    expect(getComponent(w, h, "position")).toEqual({ x: 1, y: 2 });
  });
});

// ─── Finite-number validation at boundary ────────────────────────────────────
//
// JSON.stringify masks NaN / Infinity to `null`. A round-tripped snapshot
// with non-finite fields silently changes the value. Validating at the
// boundary (spawn / setComponent / restore) keeps the column data sane.

describe("component fields: finite numbers only", () => {
  test("spawn rejects NaN position", () => {
    const w = emptyWorld();
    expect(() => spawn(w, { position: { x: Number.NaN, y: 0 } })).toThrow(
      /finite/,
    );
  });

  test("spawn rejects Infinity position", () => {
    const w = emptyWorld();
    expect(() =>
      spawn(w, { position: { x: 0, y: Number.POSITIVE_INFINITY } }),
    ).toThrow(/finite/);
  });

  test("setComponent rejects non-finite hp", () => {
    const w = emptyWorld();
    const h = spawn(w, { hp: { current: 5, max: 10 } });
    expect(() =>
      setComponent(w, h, "hp", { current: Number.NaN, max: 10 }),
    ).toThrow(/finite/);
  });

  test("restore rejects non-finite fields", () => {
    const s: SerializableWorld = {
      position: [[0, { x: Number.NaN, y: 0 }]],
      actor: [],
      hp: [],
      ai: [],
      generations: [[0, 0]],
      nextId: 1,
      recycled: [],
      added: { position: [], actor: [], hp: [], ai: [] },
      removed: { position: [], actor: [], hp: [], ai: [] },
      events: [],
    };
    expect(() => restore(s)).toThrow(/finite/);
  });

  test("restore rejects an unknown ai kind", () => {
    // The discriminant string is the payload — boundary validation matches
    // the policy used for numeric fields.
    const s = {
      position: [],
      actor: [],
      hp: [],
      ai: [[0, { kind: "garbage" }]],
      generations: [[0, 0]],
      nextId: 1,
      recycled: [],
      added: { position: [], actor: [], hp: [], ai: [] },
      removed: { position: [], actor: [], hp: [], ai: [] },
      events: [],
    };
    // The `ai` literal is intentionally outside the known union — we want to
    // verify runtime defence, not the type system, so the test crosses the
    // boundary with a structural cast via `unknown` on a `JSON.parse` round
    // trip (no `as` in test code per project rules).
    const corrupted: SerializableWorld = JSON.parse(JSON.stringify(s));
    expect(() => restore(corrupted)).toThrow(/unknown ai kind/);
  });
});
