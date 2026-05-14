// Hash-pinned regression for the ECS. Each canary seed drives a deterministic
// sequence of spawn / despawn / setComponent / removeComponent ops; the
// resulting World is hashed (FNV-1a 32-bit) and the hash is pinned here.
//
// If a hash drifts, STOP. Don't relax the assertion. Either:
//   - You changed observable ECS semantics on purpose → accept the new hash
//     in the same commit and explain why in the message.
//   - You broke determinism by accident → fix it. This test is your tripwire
//     for "save/replay still byte-matches across a refactor".
//
// The hashes pinned in this file are the **post-sparse-set-migration** baseline:
// they reflect dense-array swap-and-pop ordering, not id-sorted iteration.

import { describe, expect, test } from "bun:test";
import { createRng, type Rng } from "../../rng/index";
import {
  type Actor,
  type ComponentKey,
  despawn,
  type EntityHandle,
  emptyWorld,
  type HP,
  type Position,
  removeComponent,
  setComponent,
  snapshot,
  spawn,
  type World,
} from "../index";

// ─── Hash ────────────────────────────────────────────────────────────────────

function mix(h: number, v: number): number {
  return Math.imul(h ^ (v | 0), 16777619) | 0;
}

function mixStr(h: number, s: string): number {
  let acc = h;
  for (let i = 0; i < s.length; i++) acc = mix(acc, s.charCodeAt(i));
  return acc;
}

function hashWorld(w: World): number {
  // Capture everything observable: dense-array order, component values,
  // generation counters, allocator state.
  const s = snapshot(w);
  let h = 2166136261 | 0;

  // position column (insertion order)
  h = mix(h, s.position.length);
  for (const [id, v] of s.position) {
    h = mix(h, id);
    h = mix(h, v.x);
    h = mix(h, v.y);
  }

  // actor column
  h = mix(h, s.actor.length);
  for (const [id, v] of s.actor) {
    h = mix(h, id);
    h = mixStr(h, v.glyph);
    h = mixStr(h, v.name);
  }

  // hp column
  h = mix(h, s.hp.length);
  for (const [id, v] of s.hp) {
    h = mix(h, id);
    h = mix(h, v.current);
    h = mix(h, v.max);
  }

  // generations (sorted by id for cross-run stability — generations Map's
  // insertion order isn't part of the observable semantics). Parity of the
  // value encodes liveness (even ⇒ live, odd ⇒ slot despawned), so the
  // explicit `live` array that used to be hashed is now redundant with this
  // column.
  const genIds = s.generations.map(([id]) => id).sort((a, b) => a - b);
  const genMap = new Map(s.generations);
  h = mix(h, genIds.length);
  for (const id of genIds) {
    const g = genMap.get(id);
    if (g === undefined) continue;
    h = mix(h, id);
    h = mix(h, g);
  }

  h = mix(h, s.nextId);
  h = mix(h, s.recycled.length);
  for (const id of s.recycled) h = mix(h, id);
  return h >>> 0;
}

// ─── Scenario ────────────────────────────────────────────────────────────────

const COMPONENT_KEYS: readonly ComponentKey[] = ["actor", "hp", "position"];

function pickKey(rng: Rng): ComponentKey {
  return rng.pick(COMPONENT_KEYS);
}

function spawnRandom(rng: Rng, w: World): EntityHandle {
  // Build the components object by mutation so absent keys stay ABSENT
  // (required under exactOptionalPropertyTypes — `undefined` ≠ missing).
  const c: { position?: Position; actor?: Actor; hp?: HP } = {};
  if (rng.chance(0.9)) c.position = { x: rng.int(0, 79), y: rng.int(0, 29) };
  if (rng.chance(0.5)) {
    c.actor = {
      glyph: String.fromCharCode(97 + rng.int(0, 25)),
      name: `e${rng.int(0, 9999)}`,
    };
  }
  if (rng.chance(0.4)) {
    const max = rng.int(1, 100);
    c.hp = { current: rng.int(1, max), max };
  }
  return spawn(w, c);
}

function buildScenario(seed: number, steps: number): World {
  const rng = createRng(seed);
  const w = emptyWorld();
  const live: { id: number; gen: number }[] = [];

  for (let i = 0; i < steps; i++) {
    const choice = rng.int(0, 99);
    if (choice < 40 || live.length === 0) {
      // SPAWN
      live.push(spawnRandom(rng, w));
    } else if (choice < 65) {
      // SET-COMPONENT
      const idx = rng.int(0, live.length - 1);
      const h = live[idx];
      if (h === undefined) continue;
      const key = pickKey(rng);
      if (key === "position") {
        setComponent(w, h, key, { x: rng.int(0, 79), y: rng.int(0, 29) });
      } else if (key === "actor") {
        setComponent(w, h, key, {
          glyph: String.fromCharCode(97 + rng.int(0, 25)),
          name: `m${rng.int(0, 999)}`,
        });
      } else {
        const max = rng.int(1, 100);
        setComponent(w, h, key, { current: rng.int(0, max), max });
      }
    } else if (choice < 80) {
      // REMOVE-COMPONENT
      const idx = rng.int(0, live.length - 1);
      const h = live[idx];
      if (h === undefined) continue;
      removeComponent(w, h, pickKey(rng));
    } else {
      // DESPAWN
      const idx = rng.int(0, live.length - 1);
      const h = live[idx];
      if (h === undefined) continue;
      despawn(w, h);
      live.splice(idx, 1);
    }
  }

  return w;
}

// ─── Same-seed determinism (looser, multi-seed) ──────────────────────────────

const SCENARIO_SEEDS: readonly number[] = [
  0, 1, 2, 7, 13, 42, 0xc0ffee, 0xbadf00d, 0xdeadbeef, 0xcafebabe,
];

describe("ECS scenario determinism — many seeds", () => {
  for (const seed of SCENARIO_SEEDS) {
    test(`seed ${seed}: two runs produce identical World hash`, () => {
      const a = hashWorld(buildScenario(seed, 500));
      const b = hashWorld(buildScenario(seed, 500));
      expect(a).toBe(b);
    });
  }
});

// ─── Canary regression pins ──────────────────────────────────────────────────
//
// To regenerate after an intentional change: replace `toBe(...)` with
// `toBe(0)`, run the test, copy the "Received" values into the assertions,
// re-run, confirm green.

describe("ECS canary hashes — 500-step scenarios", () => {
  // Baseline regenerated after OPT-D (parity-encoded generation, `live` set
  // removed). Despawned-slot gen values are unchanged; respawn-after-recycle
  // gen values are bumped by 1 vs the previous baseline, and the explicit
  // `live` array is no longer mixed into the hash.
  test("seed 0 hash is pinned", () => {
    expect(hashWorld(buildScenario(0, 500))).toBe(0x756448a1);
  });
  test("seed 1 hash is pinned", () => {
    expect(hashWorld(buildScenario(1, 500))).toBe(0xc9fc00b6);
  });
  test("seed 7 hash is pinned", () => {
    expect(hashWorld(buildScenario(7, 500))).toBe(0xe9a5fcfd);
  });
  test("seed 42 hash is pinned", () => {
    expect(hashWorld(buildScenario(42, 500))).toBe(0xef796c74);
  });
  test("seed 99 hash is pinned", () => {
    expect(hashWorld(buildScenario(99, 500))).toBe(0xcd853470);
  });
});

// ─── Distribution sanity ─────────────────────────────────────────────────────

describe("ECS scenario — distribution", () => {
  test("≥ 95 of 100 seeds produce distinct hashes", () => {
    const hashes = new Set<number>();
    for (let s = 0; s < 100; s++) hashes.add(hashWorld(buildScenario(s, 500)));
    expect(hashes.size).toBeGreaterThanOrEqual(95);
  });
});
