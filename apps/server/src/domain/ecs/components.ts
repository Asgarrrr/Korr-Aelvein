/**
 * Closed union of every component an entity can carry, all optional.
 * Centralised so `Components[K]` narrows correctly in `query`/`forQuery`
 * with zero runtime registry and zero `as`. Components are plain readonly
 * data — keeps JSON round-trip trivial for save/replay.
 *
 * Adding a new component = adding a field below + a row in each per-key
 * dispatch table in `world.ts`. TS errors keep both ends honest.
 */

export type Position = {
  readonly x: number;
  readonly y: number;
};

export type Actor = {
  readonly glyph: string;
  readonly name: string;
};

export type HP = {
  readonly current: number;
  readonly max: number;
};

// Discriminated union so each AI kind can carry its own state without
// per-kind components. Wanderer carries nothing today; later kinds (chaser,
// fleer, etc.) extend this union.
export type Ai = { readonly kind: "wanderer" };

/**
 * Cyclic abstract behaviour for an NPC. Used by Phase 4's abstract resolver
 * to advance an off-zone NPC's state on a recurring schedule — e.g. a
 * villager moving between home and counter on a fixed period — without
 * spawning fine-grain pathfinding.
 *
 * Carried by the NPC entity so the state survives despawn-respawn and
 * persists through snapshot/restore. The `(time, seq)` global scheduler
 * carries only the trigger (`GlobalEvent.schedule`); the next-waypoint
 * lookup goes through `current` here.
 */
export type Schedule = {
  /** Positions the NPC cycles through, in order. Must be non-empty. */
  readonly waypoints: ReadonlyArray<readonly [number, number]>;
  /**
   * Index of the *next* waypoint to apply, in `[0, waypoints.length)`. The
   * abstract resolver reads `waypoints[nextIndex]`, moves the NPC there,
   * then advances `nextIndex` modulo `waypoints.length`. A freshly-spawned
   * NPC sets `nextIndex` to the *position after its spawn* (e.g. spawn at
   * `waypoints[0]` ⇒ `nextIndex = 1`) so the first event makes a visible
   * move.
   */
  readonly nextIndex: number;
  /** Game-ticks between two consecutive applications. Positive integer. */
  readonly period: number;
};

export type Components = {
  readonly position?: Position;
  readonly actor?: Actor;
  readonly hp?: HP;
  readonly ai?: Ai;
  readonly schedule?: Schedule;
};

export type ComponentKey = keyof Components;

// True when `T` contains the same element twice — a key listed twice in
// COMPONENT_KEYS would double-push lifecycle events in spawn/restore and drift
// the determinism hash, so the gate below must reject it as firmly as a missing
// key.
type HasDuplicate<T extends readonly unknown[]> = T extends readonly [
  infer Head,
  ...infer Tail,
]
  ? Head extends Tail[number]
    ? true
    : HasDuplicate<Tail>
  : false;

// Compile-time exhaustiveness gate for COMPONENT_KEYS. The argument's `const`
// tuple type `T` is accepted only when it covers every ComponentKey AND has no
// duplicate; otherwise the parameter type collapses to `never` and the call
// fails to type-check (no `as`, no unused dummy const). A missing or repeated
// key surfaces in the error via the `not assignable to never` mismatch.
function exhaustiveKeys<const T extends readonly ComponentKey[]>(
  keys: [Exclude<ComponentKey, T[number]>] extends [never]
    ? HasDuplicate<T> extends true
      ? never
      : T
    : never,
): T {
  return keys;
}

/**
 * Canonical iteration order over every component column. The per-key fan-out
 * in `spawn` / `despawn` / `restore` loops over this single list (via the
 * correlated-generic helpers in `world/`) instead of hand-listing the keys at
 * each site — so a new component is wired in one place. The dispatch tables in
 * `world/dispatch.ts` remain the typed chokepoint for the column plumbing.
 *
 * `exhaustiveKeys` both infers the literal-tuple type (each entry keeps its
 * `ComponentKey` literal, needed to call `columnWriters[key]` without an `as`)
 * and rejects an incomplete or duplicated list at compile time — closing the
 * silent-drop gap the old hand-written fan-out had on `spawn` and `restore`.
 *
 * Order is *not* type-enforced (any permutation type-checks): the byte-exact
 * iteration order that the lifecycle/snapshot hashes depend on is pinned by
 * `ecs/tests/determinism-locked.test.ts` — reorder this list and that test
 * fails. Keep it aligned with the field order in `Components` above.
 */
export const COMPONENT_KEYS = exhaustiveKeys([
  "position",
  "actor",
  "hp",
  "ai",
  "schedule",
]);
