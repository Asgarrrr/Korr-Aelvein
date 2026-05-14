import { describe, expect, test } from "bun:test";
import {
  despawn,
  type EntityHandle,
  emptyWorld,
  query,
  queryFiltered,
  removeComponent,
  setComponent,
  spawn,
} from "../index";

function collect<T>(g: Iterable<T>): T[] {
  const out: T[] = [];
  for (const v of g) out.push(v);
  return out;
}

describe("query", () => {
  test("yields nothing on an empty world", () => {
    const got = collect(query(emptyWorld(), ["position"]));
    expect(got).toEqual([]);
  });

  test("yields entities that carry every requested key", () => {
    const w = emptyWorld();
    const a = spawn(w, {
      position: { x: 0, y: 0 },
      hp: { current: 1, max: 1 },
    });
    spawn(w, { position: { x: 1, y: 1 } }); // no hp
    spawn(w, { hp: { current: 5, max: 5 } }); // no position
    const got = collect(query(w, ["position", "hp"]));
    expect(got.map(([h]) => h.id)).toEqual([a.id]);
  });

  test("walks the smaller column when keys differ in size", () => {
    // 10 entities with position, 2 with hp. Querying [position, hp] should
    // walk the hp column (2 entries), not position (10).
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
    const got = collect(query(w, ["position", "hp"]));
    const ids = got.map(([h]) => h.id);
    // The two matching entities are yielded in hp insertion order.
    expect(ids).toEqual([a.id, b.id]);
  });

  test("iteration order is insertion order in the pivot column", () => {
    const w = emptyWorld();
    const handles: EntityHandle[] = [];
    for (let i = 0; i < 5; i++) {
      handles.push(spawn(w, { position: { x: i, y: 0 } }));
    }
    const ids: number[] = [];
    for (const [h] of query(w, ["position"])) ids.push(h.id);
    expect(ids).toEqual([0, 1, 2, 3, 4]);
  });

  test("yields the requested keys as a non-optional view", () => {
    const w = emptyWorld();
    spawn(w, {
      position: { x: 3, y: 4 },
      actor: { glyph: "g", name: "ghoul" },
    });
    for (const [, e] of query(w, ["position"])) {
      const sum = e.position.x + e.position.y;
      expect(sum).toBe(7);
    }
  });

  test("yielded view exposes only the requested keys at runtime", () => {
    const w = emptyWorld();
    spawn(w, {
      position: { x: 1, y: 2 },
      actor: { glyph: "g", name: "ghoul" },
      hp: { current: 5, max: 5 },
    });
    for (const [, e] of query(w, ["position"])) {
      expect(Object.keys(e)).toEqual(["position"]);
    }
  });

  test("yielded view is a fresh object per call, not the stored entity", () => {
    const w = emptyWorld();
    spawn(w, { position: { x: 0, y: 0 } });
    const first = collect(query(w, ["position"]))[0];
    const second = collect(query(w, ["position"]))[0];
    if (first === undefined || second === undefined) {
      throw new Error("test setup failed");
    }
    expect(first[1]).not.toBe(second[1]);
  });

  test("handle yielded carries the entity's current generation", () => {
    const w = emptyWorld();
    const h = spawn(w, { position: { x: 0, y: 0 } });
    let seen: EntityHandle | undefined;
    for (const [h2] of query(w, ["position"])) seen = h2;
    expect(seen).toEqual(h);
  });

  test("requesting a key with no entities returns nothing (early-out)", () => {
    const w = emptyWorld();
    spawn(w, { position: { x: 0, y: 0 } });
    const got = collect(query(w, ["hp"]));
    expect(got).toEqual([]);
  });

  test("throws when called with no keys", () => {
    const w = emptyWorld();
    expect(() => collect(query(w, []))).toThrow(/at least one component key/);
  });

  test("despawn before iteration excludes the entity", () => {
    const w = emptyWorld();
    const a = spawn(w, { position: { x: 0, y: 0 } });
    const b = spawn(w, { position: { x: 1, y: 0 } });
    despawn(w, a);
    const ids = collect(query(w, ["position"])).map(([h]) => h.id);
    expect(ids).toEqual([b.id]);
  });

  test("despawn during iteration is safe (snapshot-protected)", () => {
    const w = emptyWorld();
    const handles: EntityHandle[] = [];
    for (let i = 0; i < 5; i++) {
      handles.push(spawn(w, { position: { x: i, y: 0 } }));
    }
    const yielded: number[] = [];
    for (const [h] of query(w, ["position"])) {
      yielded.push(h.id);
      // Despawn another entity mid-iter — must not crash or yield it again.
      if (h.id === 0) {
        const target = handles[2];
        if (target !== undefined) despawn(w, target);
      }
    }
    // Iteration completes; we yielded ids in the pivot-snapshot order, but
    // skipped any whose generation was bumped (the despawned entity).
    expect(yielded).toContain(0);
    expect(yielded).not.toContain(2);
  });

  // The snapshot pins the PIVOT membership at iteration start. A fresh
  // entity with the pivot component added mid-iter is NOT yielded — the
  // snapshot did not see it. This locks the "membership = at snapshot time"
  // semantic.
  test("a new pivot-key entity added mid-iter is NOT yielded", () => {
    const w = emptyWorld();
    const a = spawn(w, { position: { x: 0, y: 0 } });
    const b = spawn(w, { position: { x: 1, y: 0 } });
    const visited: number[] = [];
    let inserted: EntityHandle | undefined;
    for (const [h] of query(w, ["position"])) {
      visited.push(h.id);
      if (h.id === a.id) {
        inserted = spawn(w, { position: { x: 999, y: 999 } });
      }
    }
    expect(visited).toEqual([a.id, b.id]);
    expect(inserted).toBeDefined();
    expect(visited).not.toContain(inserted?.id);
  });

  // Secondary keys (non-pivot) are read at YIELD time from the live world,
  // not pinned by the snapshot. A pivot member whose secondary appears
  // mid-iter (via setComponent in an earlier callback) is yielded when the
  // loop reaches it — "projection is evaluated live, not at snapshot time".
  test("a missing secondary key added mid-iter to a later pivot member IS yielded", () => {
    const w = emptyWorld();
    // Pivot must be `position`. Layout:
    //   a: position + hp  ← yielded first, its callback adds hp to b.
    //   b: position only  ← yielded second, since live hp lookup now succeeds.
    //   c, d: hp only     ← swell hp column past position so pivot = position.
    const a = spawn(w, {
      position: { x: 0, y: 0 },
      hp: { current: 1, max: 1 },
    });
    const b = spawn(w, { position: { x: 1, y: 0 } });
    spawn(w, { hp: { current: 2, max: 2 } });
    spawn(w, { hp: { current: 3, max: 3 } });
    // position size = 2 (a, b). hp size = 3 (a, c, d). pivot = position.

    const visited: number[] = [];
    for (const [h] of query(w, ["position", "hp"])) {
      visited.push(h.id);
      if (h.id === a.id) {
        setComponent(w, b, "hp", { current: 99, max: 99 });
      }
    }
    // Both yielded: a (had hp at snapshot), b (hp added mid-iter, projection
    // re-reads at yield time).
    expect(visited).toEqual([a.id, b.id]);
  });

  describe("filters (with / without)", () => {
    test("with[hp] yields only entities having every with-key", () => {
      const w = emptyWorld();
      const a = spawn(w, {
        position: { x: 0, y: 0 },
        hp: { current: 1, max: 1 },
      });
      spawn(w, { position: { x: 1, y: 0 } }); // no hp — filtered out
      const b = spawn(w, {
        position: { x: 2, y: 0 },
        hp: { current: 2, max: 2 },
      });
      const ids = collect(queryFiltered(w, ["position"], { with: ["hp"] })).map(
        ([h]) => h.id,
      );
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
      const withHp = new Set(
        collect(queryFiltered(w, ["position"], { with: ["hp"] })).map(
          ([h]) => h.id,
        ),
      );
      const withoutHp = new Set(
        collect(queryFiltered(w, ["position"], { without: ["hp"] })).map(
          ([h]) => h.id,
        ),
      );
      const all = new Set(collect(query(w, ["position"])).map(([h]) => h.id));
      for (const id of all) {
        expect(withHp.has(id) || withoutHp.has(id)).toBe(true);
        expect(withHp.has(id) && withoutHp.has(id)).toBe(false);
      }
    });

    test("removeComponent on a without-key mid-iter promotes the entity", () => {
      const w = emptyWorld();
      const a = spawn(w, {
        position: { x: 0, y: 0 },
        hp: { current: 1, max: 1 },
      });
      const b = spawn(w, {
        position: { x: 1, y: 0 },
        hp: { current: 2, max: 2 },
      });
      const visited: number[] = [];
      for (const [h] of queryFiltered(w, ["position"], { without: ["hp"] })) {
        visited.push(h.id);
      }
      expect(visited).toEqual([]); // both have hp, both filtered out

      // Now strip hp from `a` (no iteration in flight) — it must re-appear.
      removeComponent(w, a, "hp");
      const visitedAfter: number[] = [];
      for (const [h] of queryFiltered(w, ["position"], { without: ["hp"] })) {
        visitedAfter.push(h.id);
      }
      expect(visitedAfter).toEqual([a.id]);
      expect(visitedAfter).not.toContain(b.id);
    });

    test("pivot stays smallest-of-keys regardless of with-key column size", () => {
      // position has 5 entries, hp has 2 — without filter, pivot = hp.
      // With keys=["position"] and with=["hp"], pivot must still be position
      // (smallest of `keys` only). Iteration order locks this.
      const w = emptyWorld();
      const handles: EntityHandle[] = [];
      for (let i = 0; i < 5; i++) {
        handles.push(spawn(w, { position: { x: i, y: 0 } }));
      }
      // Attach hp to the LAST two entities to maximise pivot-order divergence.
      const last = handles[4];
      const second = handles[3];
      if (last === undefined || second === undefined) {
        throw new Error("test setup failed");
      }
      setComponent(w, last, "hp", { current: 1, max: 1 });
      setComponent(w, second, "hp", { current: 2, max: 2 });
      const ids = collect(queryFiltered(w, ["position"], { with: ["hp"] })).map(
        ([h]) => h.id,
      );
      // hp's dense insertion order is [last, second] (last was set first).
      // position's dense insertion order is [..., second, last]. If pivot
      // were hp, yielded order would be [last.id, second.id]. Pivot is
      // position, so yielded order is [second.id, last.id] — the two
      // orderings are DISTINCT, and this assertion locks pivot to position.
      expect(ids).toEqual([second.id, last.id]);
      // Add an entity with hp only — never appears in `keys=["position"]`.
      spawn(w, { hp: { current: 99, max: 99 } });
      const idsAfter = collect(
        queryFiltered(w, ["position"], { with: ["hp"] }),
      ).map(([h]) => h.id);
      expect(idsAfter).toEqual([second.id, last.id]);
    });

    test("empty with[] and without[] are no-ops", () => {
      const w = emptyWorld();
      spawn(w, { position: { x: 0, y: 0 } });
      spawn(w, { position: { x: 1, y: 0 }, hp: { current: 1, max: 1 } });
      const base = collect(query(w, ["position"])).map(([h]) => h.id);
      const withEmpty = collect(
        queryFiltered(w, ["position"], { with: [] }),
      ).map(([h]) => h.id);
      const withoutEmpty = collect(
        queryFiltered(w, ["position"], { without: [] }),
      ).map(([h]) => h.id);
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
      const ids = collect(
        queryFiltered(w, ["position"], { with: ["hp"], without: ["actor"] }),
      ).map(([h]) => h.id);
      expect(ids).toEqual([a.id]);
    });
  });

  // Despawn-then-respawn-same-slot during iteration: the impostor must be
  // skipped (gen mismatch against the snapshot), not yielded as if it were
  // the original.
  test("despawn-respawn impostor mid-iteration is rejected (gen-pinned snapshot)", () => {
    const w = emptyWorld();
    const handles: EntityHandle[] = [];
    for (let i = 0; i < 5; i++) {
      handles.push(spawn(w, { position: { x: i, y: 0 } }));
    }
    const yielded: { id: number; x: number }[] = [];
    for (const [h, e] of query(w, ["position"])) {
      yielded.push({ id: h.id, x: e.position.x });
      if (h.id === 0) {
        // Despawn handle 2, then respawn into the same slot with a tagged
        // x — the snapshot must reject the impostor.
        const target = handles[2];
        if (target !== undefined) despawn(w, target);
        spawn(w, { position: { x: 999, y: 999 } });
      }
    }
    // No yielded entry can have x === 999 — the impostor must not surface
    // during this iteration.
    expect(yielded.some((y) => y.x === 999)).toBe(false);
  });
});
