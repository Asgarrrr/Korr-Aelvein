import { describe, expect, test } from "bun:test";
import {
  despawn,
  drainEntered,
  drainExited,
  emptyWorld,
  isLiveHandle,
  removeComponent,
  restore,
  setComponent,
  snapshot,
  spawn,
} from "../index";

describe("lifecycle buffers (added / removed)", () => {
  test("spawn pushes to added for each bound key (as handles, not bare ids)", () => {
    const w = emptyWorld();
    const a = spawn(w, {
      position: { x: 0, y: 0 },
      hp: { current: 1, max: 1 },
    });
    expect(drainEntered(w, "position")).toEqual([a]);
    expect(drainEntered(w, "hp")).toEqual([a]);
    expect(drainEntered(w, "actor")).toEqual([]);
  });

  test("setComponent on a new key pushes to added; re-write does not", () => {
    const w = emptyWorld();
    const h = spawn(w, { position: { x: 0, y: 0 } });
    drainEntered(w, "hp"); // clear from any spawn noise
    setComponent(w, h, "hp", { current: 5, max: 5 });
    expect(drainEntered(w, "hp")).toEqual([h]);
    // Re-write same key: must NOT push again.
    setComponent(w, h, "hp", { current: 4, max: 5 });
    setComponent(w, h, "hp", { current: 3, max: 5 });
    expect(drainEntered(w, "hp")).toEqual([]);
  });

  test("removeComponent pushes to removed (and only if the key was bound)", () => {
    const w = emptyWorld();
    const h = spawn(w, {
      position: { x: 0, y: 0 },
      hp: { current: 5, max: 5 },
    });
    drainEntered(w, "hp"); // discard spawn add
    removeComponent(w, h, "hp");
    expect(drainExited(w, "hp")).toEqual([h]);
    // Remove a key the entity never had: must not push.
    removeComponent(w, h, "actor");
    expect(drainExited(w, "actor")).toEqual([]);
  });

  test("despawn pushes to removed with the pre-bump (live) gen for every held column", () => {
    const w = emptyWorld();
    const a = spawn(w, {
      position: { x: 0, y: 0 },
      hp: { current: 1, max: 1 },
    });
    // Discard the spawn enters.
    drainEntered(w, "position");
    drainEntered(w, "hp");
    despawn(w, a);
    // Pushed gen is the live one (= a.gen). After bump the world's gen is
    // odd; consumer can detect the death via isLiveHandle on the captured
    // handle (returns false now that gen mismatches the bumped world gen).
    expect(drainExited(w, "position")).toEqual([a]);
    expect(drainExited(w, "hp")).toEqual([a]);
    expect(drainExited(w, "actor")).toEqual([]);
  });

  test("despawn drains every column for an entity that holds them all", () => {
    // Chokepoint test for the `columnRemovers` dispatch — adding a new
    // component without wiring it into `despawn` would survive every
    // other test (none exercise the new column on despawn) but would
    // leak a dense entry forever. This test catches that class of bug.
    const w = emptyWorld();
    const a = spawn(w, {
      position: { x: 3, y: 4 },
      actor: { glyph: "@", name: "all" },
      hp: { current: 5, max: 5 },
      ai: { kind: "wanderer" },
      schedule: {
        waypoints: [
          [0, 0],
          [1, 1],
        ],
        nextIndex: 1,
        period: 10,
      },
    });
    expect(w.position.dense.length).toBe(1);
    expect(w.actor.dense.length).toBe(1);
    expect(w.hp.dense.length).toBe(1);
    expect(w.ai.dense.length).toBe(1);
    expect(w.schedule.dense.length).toBe(1);
    despawn(w, a);
    expect(w.position.dense.length).toBe(0);
    expect(w.actor.dense.length).toBe(0);
    expect(w.hp.dense.length).toBe(0);
    expect(w.ai.dense.length).toBe(0);
    expect(w.schedule.dense.length).toBe(0);
    expect(w.position.sparse.size).toBe(0);
    expect(w.actor.sparse.size).toBe(0);
    expect(w.hp.sparse.size).toBe(0);
    expect(w.ai.sparse.size).toBe(0);
    expect(w.schedule.sparse.size).toBe(0);
    // And every column's exit buffer caught the handle.
    expect(drainExited(w, "position")).toEqual([a]);
    expect(drainExited(w, "actor")).toEqual([a]);
    expect(drainExited(w, "hp")).toEqual([a]);
    expect(drainExited(w, "ai")).toEqual([a]);
    expect(drainExited(w, "schedule")).toEqual([a]);
  });

  test("second drain returns empty (buffer cleared)", () => {
    const w = emptyWorld();
    spawn(w, { position: { x: 0, y: 0 } });
    expect(drainEntered(w, "position").length).toBe(1);
    expect(drainEntered(w, "position")).toEqual([]);
  });

  test("set-then-remove same tick records both enter and exit", () => {
    const w = emptyWorld();
    const h = spawn(w, { position: { x: 0, y: 0 } });
    setComponent(w, h, "hp", { current: 1, max: 1 });
    removeComponent(w, h, "hp");
    expect(drainEntered(w, "hp")).toEqual([h]);
    expect(drainExited(w, "hp")).toEqual([h]);
  });

  test("insertion order preserved across multiple writes", () => {
    const w = emptyWorld();
    const a = spawn(w, { position: { x: 0, y: 0 } });
    const b = spawn(w, { position: { x: 1, y: 0 } });
    const c = spawn(w, { position: { x: 2, y: 0 } });
    expect(drainEntered(w, "position")).toEqual([a, b, c]);
  });

  test("snapshot + restore round-trips lifecycle buffers byte-equal", () => {
    const w = emptyWorld();
    const a = spawn(w, {
      position: { x: 0, y: 0 },
      hp: { current: 1, max: 1 },
    });
    const b = spawn(w, { position: { x: 1, y: 0 } });
    removeComponent(w, a, "hp");

    // Capture the snapshot WITHOUT draining first — pending events must survive.
    const s = snapshot(w);
    const w2 = restore(s);

    expect(drainEntered(w2, "position")).toEqual([a, b]);
    expect(drainEntered(w2, "hp")).toEqual([a]);
    expect(drainExited(w2, "hp")).toEqual([a]);
  });

  test("restore does NOT regenerate added events from re-populated columns", () => {
    // After draining all events from `w`, snapshot+restore must yield an
    // empty buffer — restore must not push to added for each restored column.
    const w = emptyWorld();
    const a = spawn(w, { position: { x: 0, y: 0 } });
    spawn(w, { position: { x: 1, y: 0 } });
    drainEntered(w, "position"); // drain spawn enters
    const s = snapshot(w);
    const w2 = restore(s);
    expect(drainEntered(w2, "position")).toEqual([]);
    // Sanity: the columns themselves still exist.
    despawn(w2, a);
    expect(drainExited(w2, "position")).toEqual([a]);
  });

  test("emptyWorld starts with empty buffers", () => {
    const w = emptyWorld();
    expect(drainEntered(w, "position")).toEqual([]);
    expect(drainEntered(w, "actor")).toEqual([]);
    expect(drainEntered(w, "hp")).toEqual([]);
    expect(drainExited(w, "position")).toEqual([]);
    expect(drainExited(w, "actor")).toEqual([]);
    expect(drainExited(w, "hp")).toEqual([]);
  });

  test("returned array is a fresh copy (caller can mutate freely)", () => {
    const w = emptyWorld();
    spawn(w, { position: { x: 0, y: 0 } });
    spawn(w, { position: { x: 1, y: 0 } });
    const out = drainEntered(w, "position");
    out.length = 0; // caller-side mutation
    // Next drain on a fresh push still works.
    spawn(w, { position: { x: 2, y: 0 } });
    expect(drainEntered(w, "position").length).toBe(1);
  });

  // Despawn-then-recycle: the original spawn's handle and the recycled
  // spawn's handle share `id` but differ in `gen`. The drain consumer can
  // tell them apart via gen — stale-handle detection on the drained ID is
  // the whole point of returning handles instead of bare numbers.
  test("despawn-recycle within tick: drained handles carry distinct gens", () => {
    const w = emptyWorld();
    const a = spawn(w, { position: { x: 0, y: 0 } });
    drainEntered(w, "position"); // discard
    despawn(w, a);
    const recycled = spawn(w, { position: { x: 1, y: 0 } });
    expect(recycled.id).toBe(a.id);
    expect(recycled.gen).not.toBe(a.gen);

    const exited = drainExited(w, "position");
    const entered = drainEntered(w, "position");

    expect(exited).toEqual([a]); // pre-bump gen of the original
    expect(entered).toEqual([recycled]); // current gen of the recycled

    // Consumer sanity: stale handle from `exited` is rejected by isLiveHandle.
    const stale = exited[0];
    if (stale === undefined) throw new Error("test setup");
    expect(isLiveHandle(w, stale)).toBe(false);
    // Recycled handle is live.
    expect(isLiveHandle(w, recycled)).toBe(true);
  });
});
