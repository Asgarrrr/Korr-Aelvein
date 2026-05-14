import { describe, expect, test } from "bun:test";
import {
  despawn,
  type EntityHandle,
  emptyWorld,
  forQuery,
  forQueryFiltered,
  removeComponent,
  setComponent,
  spawn,
} from "../index";

// Helper: collect (handle.id, view-clone) pairs from forQuery. We clone
// because the contract is that the yielded references are reused.
function collect(fn: (cb: (h: EntityHandle, v: object) => void) => void): {
  id: number;
  keys: string[];
}[] {
  const out: { id: number; keys: string[] }[] = [];
  fn((h, v) => {
    out.push({ id: h.id, keys: Object.keys(v) });
  });
  return out;
}

describe("forQuery", () => {
  test("invokes nothing on an empty world", () => {
    const got = collect((cb) => forQuery(emptyWorld(), ["position"], cb));
    expect(got).toEqual([]);
  });

  test("invokes for entities that carry every requested key", () => {
    const w = emptyWorld();
    const a = spawn(w, {
      position: { x: 0, y: 0 },
      hp: { current: 1, max: 1 },
    });
    spawn(w, { position: { x: 1, y: 1 } }); // no hp
    spawn(w, { hp: { current: 5, max: 5 } }); // no position
    const got: number[] = [];
    forQuery(w, ["position", "hp"], (h) => {
      got.push(h.id);
    });
    expect(got).toEqual([a.id]);
  });

  test("walks the smaller column when keys differ in size", () => {
    const w = emptyWorld();
    for (let i = 0; i < 10; i++) spawn(w, { position: { x: i, y: 0 } });
    const a = spawn(w, {
      position: { x: 99, y: 0 },
      hp: { current: 1, max: 1 },
    });
    const b = spawn(w, {
      position: { x: 100, y: 0 },
      hp: { current: 2, max: 2 },
    });
    const got: number[] = [];
    forQuery(w, ["position", "hp"], (h) => {
      got.push(h.id);
    });
    expect(got).toEqual([a.id, b.id]);
  });

  test("iteration order is insertion order in the pivot column", () => {
    const w = emptyWorld();
    for (let i = 0; i < 5; i++) spawn(w, { position: { x: i, y: 0 } });
    const ids: number[] = [];
    forQuery(w, ["position"], (h) => {
      ids.push(h.id);
    });
    expect(ids).toEqual([0, 1, 2, 3, 4]);
  });

  test("invokes the requested keys as a non-optional view", () => {
    const w = emptyWorld();
    spawn(w, {
      position: { x: 3, y: 4 },
      actor: { glyph: "g", name: "ghoul" },
    });
    forQuery(w, ["position"], (_h, e) => {
      const sum = e.position.x + e.position.y;
      expect(sum).toBe(7);
    });
  });

  test("view exposes only the requested keys at runtime", () => {
    const w = emptyWorld();
    spawn(w, {
      position: { x: 1, y: 2 },
      actor: { glyph: "g", name: "ghoul" },
      hp: { current: 5, max: 5 },
    });
    forQuery(w, ["position"], (_h, e) => {
      expect(Object.keys(e)).toEqual(["position"]);
    });
  });

  // CONTRACT: handle + view are reused across calls within a single forQuery
  // call. Documenting it as a test so future refactors don't accidentally
  // re-introduce per-entity allocation thinking it's a bugfix.
  test("handle + view references are reused across invocations (contract)", () => {
    const w = emptyWorld();
    spawn(w, { position: { x: 1, y: 1 } });
    spawn(w, { position: { x: 2, y: 2 } });
    const handlesSeen: EntityHandle[] = [];
    const viewsSeen: { position: { x: number; y: number } }[] = [];
    forQuery(w, ["position"], (h, v) => {
      handlesSeen.push(h);
      viewsSeen.push(v);
    });
    expect(handlesSeen).toHaveLength(2);
    expect(viewsSeen).toHaveLength(2);
    // The user-visible aliasing of these references is the contract — a
    // caller MUST NOT retain them across yields.
    expect(handlesSeen[0]).toBe(handlesSeen[1]);
    expect(viewsSeen[0]).toBe(viewsSeen[1]);
  });

  test("handle invoked carries the entity's current generation", () => {
    const w = emptyWorld();
    const h = spawn(w, { position: { x: 0, y: 0 } });
    let seenId = -1;
    let seenGen = -1;
    forQuery(w, ["position"], (h2) => {
      seenId = h2.id;
      seenGen = h2.gen;
    });
    expect(seenId).toBe(h.id);
    expect(seenGen).toBe(h.gen);
  });

  test("requesting a key with no entities invokes nothing (early-out)", () => {
    const w = emptyWorld();
    spawn(w, { position: { x: 0, y: 0 } });
    const got: number[] = [];
    forQuery(w, ["hp"], (h) => {
      got.push(h.id);
    });
    expect(got).toEqual([]);
  });

  test("throws when called with no keys", () => {
    const w = emptyWorld();
    expect(() =>
      forQuery(w, [], () => {
        /* unreachable */
      }),
    ).toThrow(/at least one component key/);
  });

  test("despawn before iteration excludes the entity", () => {
    const w = emptyWorld();
    const a = spawn(w, { position: { x: 0, y: 0 } });
    const b = spawn(w, { position: { x: 1, y: 0 } });
    despawn(w, a);
    const ids: number[] = [];
    forQuery(w, ["position"], (h) => {
      ids.push(h.id);
    });
    expect(ids).toEqual([b.id]);
  });

  test("despawn during iteration is safe (snapshot-protected)", () => {
    const w = emptyWorld();
    const handles: EntityHandle[] = [];
    for (let i = 0; i < 5; i++) {
      handles.push(spawn(w, { position: { x: i, y: 0 } }));
    }
    const invoked: number[] = [];
    forQuery(w, ["position"], (h) => {
      invoked.push(h.id);
      if (h.id === 0) {
        const target = handles[2];
        if (target !== undefined) despawn(w, target);
      }
    });
    expect(invoked).toContain(0);
    expect(invoked).not.toContain(2);
  });

  // The snapshot pins pivot membership at iteration start. A fresh entity
  // with the pivot component added mid-iter is not invoked.
  test("a new pivot-key entity added mid-iter is NOT invoked", () => {
    const w = emptyWorld();
    const a = spawn(w, { position: { x: 0, y: 0 } });
    const b = spawn(w, { position: { x: 1, y: 0 } });
    const visited: number[] = [];
    let inserted: EntityHandle | undefined;
    forQuery(w, ["position"], (h) => {
      visited.push(h.id);
      if (h.id === a.id) {
        inserted = spawn(w, { position: { x: 999, y: 999 } });
      }
    });
    expect(visited).toEqual([a.id, b.id]);
    expect(inserted).toBeDefined();
    expect(visited).not.toContain(inserted?.id);
  });

  // Secondary keys are read at callback time, not pinned. Adding a secondary
  // mid-iter to a later pivot member promotes it into the next invocation.
  test("a missing secondary key added mid-iter to a later pivot member IS invoked", () => {
    const w = emptyWorld();
    // pivot = position (size 2) < hp (size 3). a yielded first triggers
    // adding hp to b, which is then invoked when reached.
    const a = spawn(w, {
      position: { x: 0, y: 0 },
      hp: { current: 1, max: 1 },
    });
    const b = spawn(w, { position: { x: 1, y: 0 } });
    spawn(w, { hp: { current: 2, max: 2 } });
    spawn(w, { hp: { current: 3, max: 3 } });

    const visited: number[] = [];
    forQuery(w, ["position", "hp"], (h) => {
      visited.push(h.id);
      if (h.id === a.id) {
        setComponent(w, b, "hp", { current: 99, max: 99 });
      }
    });
    expect(visited).toEqual([a.id, b.id]);
  });

  test("despawn-respawn impostor mid-iteration is rejected (gen-pinned snapshot)", () => {
    const w = emptyWorld();
    const handles: EntityHandle[] = [];
    for (let i = 0; i < 5; i++) {
      handles.push(spawn(w, { position: { x: i, y: 0 } }));
    }
    const invoked: { id: number; x: number }[] = [];
    forQuery(w, ["position"], (h, e) => {
      invoked.push({ id: h.id, x: e.position.x });
      if (h.id === 0) {
        const target = handles[2];
        if (target !== undefined) despawn(w, target);
        spawn(w, { position: { x: 999, y: 999 } });
      }
    });
    expect(invoked.some((y) => y.x === 999)).toBe(false);
  });

  describe("filters (with / without)", () => {
    test("with[hp] invokes only entities having every with-key", () => {
      const w = emptyWorld();
      const a = spawn(w, {
        position: { x: 0, y: 0 },
        hp: { current: 1, max: 1 },
      });
      spawn(w, { position: { x: 1, y: 0 } });
      const b = spawn(w, {
        position: { x: 2, y: 0 },
        hp: { current: 2, max: 2 },
      });
      const ids: number[] = [];
      forQueryFiltered(w, ["position"], { with: ["hp"] }, (h) => {
        ids.push(h.id);
      });
      expect(ids).toEqual([a.id, b.id]);
    });

    test("without[hp] is the exact complement of with[hp]", () => {
      const w = emptyWorld();
      spawn(w, {
        position: { x: 0, y: 0 },
        hp: { current: 1, max: 1 },
      });
      spawn(w, { position: { x: 1, y: 0 } });
      spawn(w, {
        position: { x: 2, y: 0 },
        hp: { current: 2, max: 2 },
      });
      const withHp: number[] = [];
      forQueryFiltered(w, ["position"], { with: ["hp"] }, (h) => {
        withHp.push(h.id);
      });
      const withoutHp: number[] = [];
      forQueryFiltered(w, ["position"], { without: ["hp"] }, (h) => {
        withoutHp.push(h.id);
      });
      const all: number[] = [];
      forQuery(w, ["position"], (h) => {
        all.push(h.id);
      });
      const a = new Set(withHp);
      const b = new Set(withoutHp);
      for (const id of all) {
        expect(a.has(id) || b.has(id)).toBe(true);
        expect(a.has(id) && b.has(id)).toBe(false);
      }
    });

    test("removeComponent on a without-key (between iterations) promotes the entity", () => {
      const w = emptyWorld();
      const a = spawn(w, {
        position: { x: 0, y: 0 },
        hp: { current: 1, max: 1 },
      });
      spawn(w, {
        position: { x: 1, y: 0 },
        hp: { current: 2, max: 2 },
      });
      const first: number[] = [];
      forQueryFiltered(w, ["position"], { without: ["hp"] }, (h) => {
        first.push(h.id);
      });
      expect(first).toEqual([]);

      removeComponent(w, a, "hp");
      const second: number[] = [];
      forQueryFiltered(w, ["position"], { without: ["hp"] }, (h) => {
        second.push(h.id);
      });
      expect(second).toEqual([a.id]);
    });

    test("pivot stays smallest-of-keys regardless of with-key column size", () => {
      const w = emptyWorld();
      const handles: EntityHandle[] = [];
      for (let i = 0; i < 5; i++) {
        handles.push(spawn(w, { position: { x: i, y: 0 } }));
      }
      const last = handles[4];
      const second = handles[3];
      if (last === undefined || second === undefined) {
        throw new Error("test setup failed");
      }
      setComponent(w, last, "hp", { current: 1, max: 1 });
      setComponent(w, second, "hp", { current: 2, max: 2 });
      const ids: number[] = [];
      forQueryFiltered(w, ["position"], { with: ["hp"] }, (h) => {
        ids.push(h.id);
      });
      expect(ids).toEqual([second.id, last.id]);

      spawn(w, { hp: { current: 99, max: 99 } });
      const idsAfter: number[] = [];
      forQueryFiltered(w, ["position"], { with: ["hp"] }, (h) => {
        idsAfter.push(h.id);
      });
      expect(idsAfter).toEqual([second.id, last.id]);
    });

    test("empty with[] and without[] are no-ops", () => {
      const w = emptyWorld();
      spawn(w, { position: { x: 0, y: 0 } });
      spawn(w, { position: { x: 1, y: 0 }, hp: { current: 1, max: 1 } });
      const base: number[] = [];
      forQuery(w, ["position"], (h) => {
        base.push(h.id);
      });
      const withEmpty: number[] = [];
      forQueryFiltered(w, ["position"], { with: [] }, (h) => {
        withEmpty.push(h.id);
      });
      const withoutEmpty: number[] = [];
      forQueryFiltered(w, ["position"], { without: [] }, (h) => {
        withoutEmpty.push(h.id);
      });
      expect(withEmpty).toEqual(base);
      expect(withoutEmpty).toEqual(base);
    });

    test("combining with and without intersects the two filters", () => {
      const w = emptyWorld();
      const a = spawn(w, {
        position: { x: 0, y: 0 },
        hp: { current: 1, max: 1 },
      });
      spawn(w, {
        position: { x: 1, y: 0 },
        hp: { current: 2, max: 2 },
        actor: { glyph: "@", name: "x" },
      });
      spawn(w, { position: { x: 2, y: 0 } });
      const ids: number[] = [];
      forQueryFiltered(
        w,
        ["position"],
        { with: ["hp"], without: ["actor"] },
        (h) => {
          ids.push(h.id);
        },
      );
      expect(ids).toEqual([a.id]);
    });
  });
});
