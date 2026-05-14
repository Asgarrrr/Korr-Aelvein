import { describe, expect, test } from "bun:test";
import {
  despawn,
  emptyWorld,
  query,
  setComponent,
  snapshot,
  spawn,
  type World,
} from "../index";

// Same operations on two fresh worlds must produce snapshots that compare
// equal. We use `snapshot()` rather than the World object itself because the
// World is mutable; `snapshot()` returns a JSON-friendly value with no
// hidden identity.

function buildWorld(): World {
  const w = emptyWorld();
  const handles: { id: number; gen: number }[] = [];
  for (let i = 0; i < 10; i++) {
    handles.push(
      spawn(w, {
        position: { x: i, y: i * 2 },
        actor: { glyph: String.fromCharCode(97 + i), name: `e${i}` },
      }),
    );
  }
  // Mutate, despawn some, respawn — exercise the recycling path.
  const h2 = handles[2];
  const h5 = handles[5];
  const h7 = handles[7];
  if (h2 === undefined || h5 === undefined || h7 === undefined) {
    throw new Error("test setup failed");
  }
  setComponent(w, h2, "hp", { current: 8, max: 10 });
  despawn(w, h5);
  despawn(w, h7);
  spawn(w, { position: { x: 99, y: 99 } });
  return w;
}

describe("ECS determinism", () => {
  test("same operations produce identical snapshots", () => {
    const a = buildWorld();
    const b = buildWorld();
    expect(snapshot(a)).toEqual(snapshot(b));
  });

  test("query iteration order is stable across rebuilds", () => {
    const a = buildWorld();
    const b = buildWorld();
    const ai: number[] = [];
    const bi: number[] = [];
    for (const [h] of query(a, ["position"])) ai.push(h.id);
    for (const [h] of query(b, ["position"])) bi.push(h.id);
    expect(ai).toEqual(bi);
  });

  test("recycling reuses the most-recently-freed id (LIFO)", () => {
    // In buildWorld(): h5 despawned, then h7 despawned, then one fresh spawn.
    // LIFO pops h7 first → recycled stack still holds h5.
    const w = buildWorld();
    expect(w.recycled).toEqual([5]);
  });
});
