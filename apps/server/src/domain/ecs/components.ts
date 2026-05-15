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
