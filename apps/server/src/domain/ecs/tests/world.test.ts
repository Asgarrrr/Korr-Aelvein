import { describe, expect, test } from "bun:test";
import {
  despawn,
  emptyWorld,
  getComponent,
  isLiveHandle,
  removeComponent,
  restore,
  setComponent,
  snapshot,
  spawn,
} from "../index";

describe("emptyWorld", () => {
  test("returns a world with no entities, nextId 0, no recycled ids", () => {
    const w = emptyWorld();
    expect(w.position.dense.length).toBe(0);
    expect(w.actor.dense.length).toBe(0);
    expect(w.hp.dense.length).toBe(0);
    expect(w.generations.size).toBe(0);
    expect(w.nextId).toBe(0);
    expect(w.recycled).toEqual([]);
  });
});

describe("spawn", () => {
  test("first spawn yields id 0, gen 0, nextId 1", () => {
    const w = emptyWorld();
    const h = spawn(w, { position: { x: 1, y: 2 } });
    expect(h).toEqual({ id: 0, gen: 0 });
    expect(w.nextId).toBe(1);
    expect(w.generations.get(0)).toBe(0);
    expect(w.position.dense.length).toBe(1);
  });

  test("consecutive spawns allocate monotonic ids when no recycled slots", () => {
    const w = emptyWorld();
    const ids: number[] = [];
    for (let i = 0; i < 5; i++) {
      const h = spawn(w, { position: { x: i, y: 0 } });
      ids.push(h.id);
    }
    expect(ids).toEqual([0, 1, 2, 3, 4]);
    expect(w.nextId).toBe(5);
    expect(w.position.dense.length).toBe(5);
  });

  test("only populates columns matching the components passed", () => {
    const w = emptyWorld();
    spawn(w, { position: { x: 0, y: 0 } });
    expect(w.position.dense.length).toBe(1);
    expect(w.actor.dense.length).toBe(0);
    expect(w.hp.dense.length).toBe(0);
  });

  test("stores components by value", () => {
    const w = emptyWorld();
    const h = spawn(w, {
      position: { x: 7, y: 8 },
      actor: { glyph: "@", name: "you" },
    });
    expect(getComponent(w, h, "position")).toEqual({ x: 7, y: 8 });
    expect(getComponent(w, h, "actor")).toEqual({ glyph: "@", name: "you" });
    expect(getComponent(w, h, "hp")).toBeUndefined();
  });
});

describe("despawn", () => {
  test("removes the entity from every column and bumps the generation", () => {
    const w = emptyWorld();
    const h = spawn(w, {
      position: { x: 0, y: 0 },
      hp: { current: 5, max: 5 },
    });
    despawn(w, h);
    expect(w.position.dense.length).toBe(0);
    expect(w.hp.dense.length).toBe(0);
    expect(w.generations.get(h.id)).toBe(1);
    expect(w.recycled).toEqual([h.id]);
  });

  test("despawn with a stale handle is a no-op", () => {
    const w = emptyWorld();
    const h = spawn(w, { position: { x: 0, y: 0 } });
    despawn(w, h);
    const before = {
      nextId: w.nextId,
      recycled: [...w.recycled],
      gen: w.generations.get(h.id),
    };
    despawn(w, h);
    expect(w.nextId).toBe(before.nextId);
    expect(w.recycled).toEqual(before.recycled);
    expect(w.generations.get(h.id)).toBe(before.gen);
  });

  test("recycled slot is reused on next spawn with incremented generation", () => {
    const w = emptyWorld();
    const h0 = spawn(w, { position: { x: 0, y: 0 } });
    despawn(w, h0);
    const h1 = spawn(w, { position: { x: 9, y: 9 } });
    expect(h1.id).toBe(h0.id);
    // Parity-encoded: spawn → gen 0 (even, live), despawn → gen 1
    // (odd, dead), respawn → gen 2 (even, live).
    expect(h1.gen).toBe(2);
    expect(w.recycled).toEqual([]);
    expect(w.nextId).toBe(1);
  });

  test("LIFO recycling: last despawned id is reused first", () => {
    const w = emptyWorld();
    const h0 = spawn(w, { position: { x: 0, y: 0 } });
    const h1 = spawn(w, { position: { x: 1, y: 0 } });
    const h2 = spawn(w, { position: { x: 2, y: 0 } });
    despawn(w, h0);
    despawn(w, h2);
    const next = spawn(w, { position: { x: 99, y: 99 } });
    expect(next.id).toBe(h2.id);
    // silence unused
    expect(h1.id).toBe(1);
  });
});

describe("isLiveHandle", () => {
  test("true for a freshly spawned handle", () => {
    const w = emptyWorld();
    const h = spawn(w, { position: { x: 0, y: 0 } });
    expect(isLiveHandle(w, h)).toBe(true);
  });

  test("false for a despawned handle", () => {
    const w = emptyWorld();
    const h = spawn(w, { position: { x: 0, y: 0 } });
    despawn(w, h);
    expect(isLiveHandle(w, h)).toBe(false);
  });

  test("false for a stale handle after slot recycling", () => {
    const w = emptyWorld();
    const h0 = spawn(w, { position: { x: 0, y: 0 } });
    despawn(w, h0);
    spawn(w, { position: { x: 1, y: 1 } });
    expect(isLiveHandle(w, h0)).toBe(false);
  });

  test("false for an unknown id", () => {
    const w = emptyWorld();
    expect(isLiveHandle(w, { id: 999, gen: 0 })).toBe(false);
  });

  // Ghost-handle defense: a handle reconstructed from the bumped generation
  // between despawn and respawn must read as DEAD, not alive — otherwise a
  // caller could double-despawn the slot and corrupt the recycled stack.
  test("false for a ghost handle constructed from the bumped generation", () => {
    const w = emptyWorld();
    const h = spawn(w, { position: { x: 0, y: 0 } });
    despawn(w, h);
    const bumpedGen = w.generations.get(h.id);
    if (bumpedGen === undefined) throw new Error("setup: generation lost");
    const ghost = { id: h.id, gen: bumpedGen };
    expect(isLiveHandle(w, ghost)).toBe(false);
  });

  test("despawn on a ghost handle is a no-op (no double-push to recycled)", () => {
    const w = emptyWorld();
    const h = spawn(w, { position: { x: 0, y: 0 } });
    despawn(w, h);
    expect(w.recycled).toEqual([h.id]);
    const bumpedGen = w.generations.get(h.id);
    if (bumpedGen === undefined) throw new Error("setup: generation lost");
    despawn(w, { id: h.id, gen: bumpedGen });
    // Recycled stack must NOT contain h.id twice — that would let two
    // subsequent spawns return handles claiming the same (id, gen).
    expect(w.recycled).toEqual([h.id]);
  });
});

describe("setComponent", () => {
  test("adds a previously-absent component", () => {
    const w = emptyWorld();
    const h = spawn(w, { position: { x: 0, y: 0 } });
    setComponent(w, h, "hp", { current: 10, max: 10 });
    expect(getComponent(w, h, "hp")).toEqual({ current: 10, max: 10 });
    expect(getComponent(w, h, "position")).toEqual({ x: 0, y: 0 });
  });

  test("replaces an existing component", () => {
    const w = emptyWorld();
    const h = spawn(w, { position: { x: 0, y: 0 } });
    setComponent(w, h, "position", { x: 5, y: 5 });
    expect(getComponent(w, h, "position")).toEqual({ x: 5, y: 5 });
  });

  test("stale handle is a no-op", () => {
    const w = emptyWorld();
    const h = spawn(w, { position: { x: 0, y: 0 } });
    despawn(w, h);
    setComponent(w, h, "position", { x: 5, y: 5 });
    expect(w.position.dense.length).toBe(0);
  });
});

describe("removeComponent", () => {
  test("removes a present component (swap-and-pop)", () => {
    const w = emptyWorld();
    const h = spawn(w, {
      position: { x: 0, y: 0 },
      hp: { current: 10, max: 10 },
    });
    removeComponent(w, h, "hp");
    expect(getComponent(w, h, "hp")).toBeUndefined();
    expect(getComponent(w, h, "position")).toEqual({ x: 0, y: 0 });
    expect(w.hp.dense.length).toBe(0);
  });

  test("swap-and-pop maintains sparse index for the swapped entity", () => {
    const w = emptyWorld();
    const a = spawn(w, { hp: { current: 1, max: 1 } });
    const b = spawn(w, { hp: { current: 2, max: 2 } });
    const c = spawn(w, { hp: { current: 3, max: 3 } });
    // Remove the middle entry — `c` should swap into `b`'s slot.
    removeComponent(w, b, "hp");
    expect(getComponent(w, a, "hp")).toEqual({ current: 1, max: 1 });
    expect(getComponent(w, b, "hp")).toBeUndefined();
    expect(getComponent(w, c, "hp")).toEqual({ current: 3, max: 3 });
    expect(w.hp.dense.length).toBe(2);
  });

  test("noop when the component is already absent", () => {
    const w = emptyWorld();
    const h = spawn(w, { position: { x: 0, y: 0 } });
    removeComponent(w, h, "hp");
    expect(w.hp.dense.length).toBe(0);
  });
});

describe("snapshot / restore", () => {
  test("round-trips byte-equal on a populated world", () => {
    const w = emptyWorld();
    const a = spawn(w, {
      position: { x: 1, y: 2 },
      actor: { glyph: "a", name: "alpha" },
    });
    const b = spawn(w, {
      position: { x: 3, y: 4 },
      hp: { current: 5, max: 10 },
    });
    despawn(w, a);
    const snap = snapshot(w);
    const w2 = restore(snap);
    const snap2 = snapshot(w2);
    expect(snap2).toEqual(snap);
    expect(getComponent(w2, b, "position")).toEqual({ x: 3, y: 4 });
  });

  test("survives JSON round-trip", () => {
    const w = emptyWorld();
    spawn(w, { position: { x: 1, y: 2 } });
    spawn(w, {
      actor: { glyph: "g", name: "ghost" },
      hp: { current: 5, max: 10 },
    });
    const s1 = snapshot(w);
    const s2 = JSON.parse(JSON.stringify(s1));
    const w2 = restore(s2);
    expect(snapshot(w2)).toEqual(s1);
  });
});
