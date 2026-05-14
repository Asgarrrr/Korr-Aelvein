// Stress tests — extreme-scale correctness, opt-in. These verify that the ECS
// primitives don't quietly corrupt state at scales no realistic game will
// reach. Run with `STRESS=1 bun test src/domain/ecs/tests/stress.test.ts`
// (or `bun run test:stress` from `apps/server/`).
//
// Skipped by default. After the sparse-set migration most operations are O(1),
// so these scenarios run in milliseconds rather than tens of seconds — but
// they still pin invariants (recycled stack, generation count, query yield
// count, deep mutation chain) at scales that surface array-resize boundaries
// and Map rehash effects.

import { describe, expect, test } from "bun:test";
import {
  despawn,
  type EntityHandle,
  emptyWorld,
  getComponent,
  query,
  setComponent,
  spawn,
} from "../index";

const STRESS = process.env["STRESS"] === "1";
const stressTest = test.skipIf(!STRESS);
const STRESS_TIMEOUT_MS = 60_000;

describe("ECS stress — extreme scale correctness", () => {
  stressTest(
    "1,000,000 spawn-despawn cycles on slot 0: generation reaches 2M-1",
    () => {
      const w = emptyWorld();
      for (let i = 0; i < 1_000_000; i++) {
        const h = spawn(w, { position: { x: 0, y: 0 } });
        despawn(w, h);
      }
      expect(w.position.dense.length).toBe(0);
      expect(w.recycled).toEqual([0]);
      // Parity-encoded: each spawn-despawn cycle bumps gen by 2 (even on
      // spawn, odd on despawn). Last despawn ends at 2 × 1M - 1.
      expect(w.generations.get(0)).toBe(2 * 1_000_000 - 1);
      expect(w.nextId).toBe(1);
    },
    STRESS_TIMEOUT_MS,
  );

  stressTest(
    "100,000 spawns: every id distinct, nextId reaches 100k, no recycled",
    () => {
      const w = emptyWorld();
      const ids = new Set<number>();
      for (let i = 0; i < 100_000; i++) {
        const h = spawn(w, {
          position: { x: i % 80, y: Math.floor(i / 80) % 30 },
        });
        ids.add(h.id);
      }
      expect(ids.size).toBe(100_000);
      expect(w.position.dense.length).toBe(100_000);
      expect(w.nextId).toBe(100_000);
      expect(w.recycled.length).toBe(0);
    },
    STRESS_TIMEOUT_MS,
  );

  stressTest(
    "100,000 entity query yields each entity exactly once, in insertion order",
    () => {
      const w = emptyWorld();
      for (let i = 0; i < 100_000; i++) {
        spawn(w, { position: { x: 0, y: 0 } });
      }
      let count = 0;
      let lastId = -1;
      for (const [h] of query(w, ["position"])) {
        expect(h.id).toBeGreaterThan(lastId);
        lastId = h.id;
        count++;
      }
      expect(count).toBe(100_000);
    },
    STRESS_TIMEOUT_MS,
  );

  stressTest(
    "10,000 consecutive setComponent on the same handle: final state correct",
    () => {
      const w = emptyWorld();
      const h = spawn(w, { position: { x: 0, y: 0 } });
      for (let i = 0; i < 10_000; i++) {
        setComponent(w, h, "position", { x: i, y: 0 });
      }
      expect(getComponent(w, h, "position")).toEqual({ x: 9_999, y: 0 });
    },
    STRESS_TIMEOUT_MS,
  );

  // 50k spawns, then despawn the first half. Verifies the recycled-stack
  // invariant: live entities + recycled === nextId.
  stressTest(
    "50k spawn / 25k despawn — recycled invariant holds at scale",
    () => {
      const w = emptyWorld();
      const handles: EntityHandle[] = [];
      for (let i = 0; i < 50_000; i++) {
        handles.push(spawn(w, { position: { x: i % 80, y: 0 } }));
      }
      for (let i = 0; i < 25_000; i++) {
        const h = handles[i];
        if (h === undefined) continue;
        despawn(w, h);
      }
      expect(w.position.dense.length).toBe(25_000);
      expect(w.recycled.length).toBe(25_000);
      expect(w.nextId).toBe(50_000);
      expect(w.position.dense.length + w.recycled.length).toBe(w.nextId);
    },
    STRESS_TIMEOUT_MS,
  );

  stressTest(
    "ping-pong recycling: 100k cycles on slot 0 keep generations + nextId stable",
    () => {
      const w = emptyWorld();
      for (let i = 0; i < 100_000; i++) {
        const h = spawn(w, { position: { x: 0, y: 0 } });
        expect(h.id).toBe(0);
        // Parity-encoded: the i-th spawn lands at gen 2*i (even, live).
        expect(h.gen).toBe(2 * i);
        despawn(w, h);
      }
      expect(w.nextId).toBe(1);
      // Last despawn ends at 2 × 100k - 1 (odd, slot ready for reuse).
      expect(w.generations.get(0)).toBe(2 * 100_000 - 1);
      expect(w.recycled).toEqual([0]);
    },
    STRESS_TIMEOUT_MS,
  );

  stressTest(
    "stale handle defence at scale: 100k stale setComponent calls are no-ops",
    () => {
      const w = emptyWorld();
      const stale = spawn(w, { position: { x: 0, y: 0 } });
      despawn(w, stale);
      for (let i = 0; i < 100_000; i++) {
        setComponent(w, stale, "position", { x: i, y: i });
      }
      // The position column should never have been re-populated.
      expect(w.position.dense.length).toBe(0);
    },
    STRESS_TIMEOUT_MS,
  );
});
