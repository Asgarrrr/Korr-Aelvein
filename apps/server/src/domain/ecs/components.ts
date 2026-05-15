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

export type Components = {
  readonly position?: Position;
  readonly actor?: Actor;
  readonly hp?: HP;
  readonly ai?: Ai;
};

export type ComponentKey = keyof Components;
