// World shape + `emptyWorld` factory. Lives in its own leaf so siblings
// (`snapshot.ts`, `dispatch.ts`, `index.ts`) all depend on this file and
// nothing cycles back up.

import type { ComponentKey, Components } from "../components";
import type { EntityHandle, EntityId, Generation } from "../entity";
import { type ComponentColumn, emptyColumn } from "./columns";

// Per-component append log: "entity gained this key" (`added`) or "entity
// lost this key" (`removed`) since last drain. Re-writes (setComponent on
// an already-bound key) do NOT push to `added` — only absent → present
// counts as an enter. Handles (not bare ids) so consumers can `isLiveHandle`
// and detect despawn-recycle races between push and drain.
//
// Keyed by `ComponentKey` so a new component is a compile error in every
// `world.added[K]` / `world.removed[K]` site until the new branch lands.
export type LifecycleBuffers = { [K in ComponentKey]: EntityHandle[] };

// Event channel storage. Keyed by channel.name; values are the raw event
// list. Type-erased at this layer — `events.ts` re-narrows via the channel's
// phantom T at emit/drain time. Internal to the ECS module.
export type EventBuckets = Map<string, unknown[]>;

// Column shape derived from `Components` — adding a new key in
// `../components.ts` automatically adds a column field here. `NonNullable`
// strips the `?` from `Components[K]` since columns store the present value,
// not "maybe-bound".
type ColumnsByKey = {
  readonly [K in ComponentKey]: ComponentColumn<NonNullable<Components[K]>>;
};

export type World = ColumnsByKey & {
  // Parity-encoded liveness: even gen ⇒ live, odd gen ⇒ slot despawned and
  // ready for reuse. Bounded by 2× peak entity count, never compacts.
  readonly generations: Map<EntityId, Generation>;
  nextId: EntityId;
  recycled: EntityId[];
  readonly added: LifecycleBuffers;
  readonly removed: LifecycleBuffers;
  readonly events: EventBuckets;
};

export function emptyWorld(): World {
  // The key lists below are spelled out, not built from a shared
  // `COMPONENT_KEYS` via `Object.fromEntries`: that yields `{ [k: string]: … }`,
  // which doesn't satisfy the precise `ColumnsByKey` / `LifecycleBuffers` mapped
  // types without an `as`. Explicit literals are the no-`as` cost — and the
  // mapped types still make a forgotten column a compile error here.
  return {
    position: emptyColumn(),
    actor: emptyColumn(),
    hp: emptyColumn(),
    ai: emptyColumn(),
    schedule: emptyColumn(),
    generations: new Map(),
    nextId: 0,
    recycled: [],
    added: { position: [], actor: [], hp: [], ai: [], schedule: [] },
    removed: { position: [], actor: [], hp: [], ai: [], schedule: [] },
    events: new Map(),
  };
}
