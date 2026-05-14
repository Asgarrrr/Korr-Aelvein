// Architecture, mutation model, determinism contract: see `./README.md`.

import type {
  Actor,
  ComponentKey,
  Components,
  HP,
  Position,
} from "./components";
import type { EntityHandle, EntityId, Generation } from "./entity";

type ComponentEntry<T> = {
  readonly id: EntityId;
  readonly v: T;
};

// Invariant: dense.length === sparse.size.
type ComponentColumn<T> = {
  readonly dense: ComponentEntry<T>[];
  readonly sparse: Map<EntityId, number>;
};

// Lifecycle buffers — per-component append log of "entity gained this key"
// (`added`) and "entity lost this key" (`removed`) since last drain. The
// drain APIs are the only consumers; systems own their timing. Re-writes
// (setComponent on an already-bound key) do NOT push to `added` — only
// transitions absent → present count as enters.
//
// Handles (not bare ids) are stored: gen is captured at push time. If the
// slot is despawned-recycled between push and drain, the captured gen
// mismatches the live gen and the consumer's `isLiveHandle` rejects the
// stale handle — same defense as ghost-handle rejection in queries.
type LifecycleBuffers = {
  position: EntityHandle[];
  actor: EntityHandle[];
  hp: EntityHandle[];
};

// Event channel storage. Keyed by channel.name; values are the raw event
// list. Type-erased at this layer — `events.ts` re-narrows via the channel's
// phantom T at emit/drain time. Internal to the ECS module.
type EventBuckets = Map<string, unknown[]>;

export type World = {
  readonly position: ComponentColumn<Position>;
  readonly actor: ComponentColumn<Actor>;
  readonly hp: ComponentColumn<HP>;
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
  return {
    position: { dense: [], sparse: new Map() },
    actor: { dense: [], sparse: new Map() },
    hp: { dense: [], sparse: new Map() },
    generations: new Map(),
    nextId: 0,
    recycled: [],
    added: { position: [], actor: [], hp: [] },
    removed: { position: [], actor: [], hp: [] },
    events: new Map(),
  };
}

// Live iff the slot's recorded gen matches the handle's AND is even. A ghost
// handle constructed from the bumped (odd) despawn gen passes the equality
// but fails the parity check. A handle whose gen no longer matches the slot
// is stale across recycling (different generation entirely).
export function isLiveHandle(world: World, handle: EntityHandle): boolean {
  const gen = world.generations.get(handle.id);
  if (gen === undefined) return false;
  if (gen !== handle.gen) return false;
  return (gen & 1) === 0;
}

// ─── Validation + per-component cloning ─────────────────────────────────────
//
// Components are stored by value (defensive shallow copy). Without this, a
// caller's `const p = {x:1,y:2}; spawn(w, {position:p}); p.x = 99` would
// silently mutate world state through an aliased reference — the `readonly`
// modifier on the public types is a compile-time hint, not a runtime guard.
//
// Validation rejects NaN / Infinity at boundary. JSON.stringify masks NaN
// to `null` and the snapshot would survive but the restored value would
// not match `Position.x: number`, breaking determinism downstream.

const MAX_SAFE_GENERATION = 0x7fff_ffff; // 2^31 - 1

function assertFinite(label: string, value: number): void {
  if (!Number.isFinite(value)) {
    throw new Error(`${label}: expected finite number, got ${value}`);
  }
}

function cloneAndValidatePosition(v: Position): Position {
  assertFinite("position.x", v.x);
  assertFinite("position.y", v.y);
  return { x: v.x, y: v.y };
}

function cloneActor(v: Actor): Actor {
  return { glyph: v.glyph, name: v.name };
}

function cloneAndValidateHP(v: HP): HP {
  assertFinite("hp.current", v.current);
  assertFinite("hp.max", v.max);
  return { current: v.current, max: v.max };
}

function assertSafeGeneration(id: EntityId, gen: Generation): void {
  if (!Number.isInteger(gen) || gen < 0 || gen > MAX_SAFE_GENERATION) {
    throw new Error(
      `generation for id ${id} out of safe range [0, ${MAX_SAFE_GENERATION}]: ${gen}`,
    );
  }
}

// ─── Internal column primitives ──────────────────────────────────────────────

function readFromColumn<T>(
  col: ComponentColumn<T>,
  id: EntityId,
): T | undefined {
  const idx = col.sparse.get(id);
  if (idx === undefined) return undefined;
  const entry = col.dense[idx];
  if (entry === undefined) {
    throw new Error(
      `readFromColumn: invariant violated — sparse[${id}] = ${idx} but dense[${idx}] is empty`,
    );
  }
  return entry.v;
}

function setInColumn<T>(col: ComponentColumn<T>, id: EntityId, v: T): void {
  const idx = col.sparse.get(id);
  if (idx === undefined) {
    col.sparse.set(id, col.dense.length);
    col.dense.push({ id, v });
    return;
  }
  col.dense[idx] = { id, v };
}

// Swap-and-pop removal: O(1). The entry at the last position moves into the
// removed slot; sparse index updates accordingly. After this call `dense`
// has length-1 entries and `sparse` lacks `id`.
function removeFromColumn<T>(col: ComponentColumn<T>, id: EntityId): void {
  const idx = col.sparse.get(id);
  if (idx === undefined) return;
  const lastIdx = col.dense.length - 1;
  if (idx !== lastIdx) {
    const lastEntry = col.dense[lastIdx];
    if (lastEntry === undefined) {
      throw new Error(
        `removeFromColumn: invariant violated — dense[${lastIdx}] is empty while length = ${col.dense.length}`,
      );
    }
    col.dense[idx] = lastEntry;
    col.sparse.set(lastEntry.id, idx);
  }
  col.dense.pop();
  col.sparse.delete(id);
}

// ─── Per-key dispatch tables ────────────────────────────────────────────────
//
// Mapped types `{ [K in ComponentKey]: ... }` keep `getComponent<K>` /
// `setComponent<K>` generic without `as`. The runtime cost is one
// monomorphic property access per call — V8 inlines it.

type ColumnReaders = {
  [K in ComponentKey]: (w: World, id: EntityId) => Components[K] | undefined;
};

const columnReaders: ColumnReaders = {
  position: (w, id) => readFromColumn(w.position, id),
  actor: (w, id) => readFromColumn(w.actor, id),
  hp: (w, id) => readFromColumn(w.hp, id),
};

type ColumnWriters = {
  [K in ComponentKey]: (
    w: World,
    id: EntityId,
    v: NonNullable<Components[K]>,
  ) => void;
};

const columnWriters: ColumnWriters = {
  position: (w, id, v) =>
    setInColumn(w.position, id, cloneAndValidatePosition(v)),
  actor: (w, id, v) => setInColumn(w.actor, id, cloneActor(v)),
  hp: (w, id, v) => setInColumn(w.hp, id, cloneAndValidateHP(v)),
};

type ColumnRemovers = {
  [K in ComponentKey]: (w: World, id: EntityId) => void;
};

const columnRemovers: ColumnRemovers = {
  position: (w, id) => removeFromColumn(w.position, id),
  actor: (w, id) => removeFromColumn(w.actor, id),
  hp: (w, id) => removeFromColumn(w.hp, id),
};

type ColumnSizes = { [K in ComponentKey]: (w: World) => number };

const columnSizes: ColumnSizes = {
  position: (w) => w.position.dense.length,
  actor: (w) => w.actor.dense.length,
  hp: (w) => w.hp.dense.length,
};

type ColumnHas = { [K in ComponentKey]: (w: World, id: EntityId) => boolean };

// Presence-only check. Skips reading the dense entry — query filters
// (`with`/`without`) only need "is this key bound?", not the value.
const columnHas: ColumnHas = {
  position: (w, id) => w.position.sparse.has(id),
  actor: (w, id) => w.actor.sparse.has(id),
  hp: (w, id) => w.hp.sparse.has(id),
};

// SoA single-pass snapshot of (id, gen) pairs in dense order. Used by
// `query.ts` so that mutating the iterated column mid-query doesn't corrupt
// iteration AND so we don't allocate N temporary `{id, gen}` objects per
// query call. The mapped-type dispatch makes a new component a compile error
// until you fill in the slot here.
type ColumnSnapshot = {
  [K in ComponentKey]: (w: World) => {
    ids: EntityId[];
    gens: Generation[];
  };
};

function snapshotColumn<T>(
  dense: ComponentEntry<T>[],
  generations: Map<EntityId, Generation>,
): { ids: EntityId[]; gens: Generation[] } {
  const n = dense.length;
  const ids: EntityId[] = new Array(n);
  const gens: Generation[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const e = dense[i];
    if (e === undefined) {
      throw new Error(
        `snapshotColumn: invariant violated — dense[${i}] is empty while length = ${n}`,
      );
    }
    const gen = generations.get(e.id);
    if (gen === undefined) {
      throw new Error(
        `snapshotColumn: invariant violated — dense entity ${e.id} has no generation entry`,
      );
    }
    ids[i] = e.id;
    gens[i] = gen;
  }
  return { ids, gens };
}

const columnSnapshots: ColumnSnapshot = {
  position: (w) => snapshotColumn(w.position.dense, w.generations),
  actor: (w) => snapshotColumn(w.actor.dense, w.generations),
  hp: (w) => snapshotColumn(w.hp.dense, w.generations),
};

// ─── Public API ──────────────────────────────────────────────────────────────

function allocId(world: World): EntityId {
  const reuse = world.recycled.pop();
  if (reuse !== undefined) return reuse;
  const id = world.nextId;
  world.nextId = id + 1;
  return id;
}

export function spawn(world: World, c: Components): EntityHandle {
  const id = allocId(world);
  // Fresh slot ⇒ gen 0 (even, live). Recycled slot ⇒ stored is odd
  // (gen-at-despawn + 1); advance by 1 to land on the next even live gen.
  const stored = world.generations.get(id);
  const gen = stored === undefined ? 0 : stored + 1;
  world.generations.set(id, gen);
  // Single handle allocation, shared across all lifecycle buffers and the
  // return. Drain clones at consumption, so the aliasing is invisible to
  // callers; internally nothing mutates handles. Saves 3 allocs per spawn
  // on the 3-key case (~60 ns at N=5000).
  const handle: EntityHandle = { id, gen };
  if (c.position !== undefined) {
    columnWriters.position(world, id, c.position);
    world.added.position.push(handle);
  }
  if (c.actor !== undefined) {
    columnWriters.actor(world, id, c.actor);
    world.added.actor.push(handle);
  }
  if (c.hp !== undefined) {
    columnWriters.hp(world, id, c.hp);
    world.added.hp.push(handle);
  }
  return handle;
}

export function despawn(world: World, handle: EntityHandle): void {
  if (!isLiveHandle(world, handle)) return;
  // Push to `removed` BEFORE the actual column removal — only push for keys
  // the entity still holds. Avoids spurious "removed X" events for columns
  // the entity never had. The caller's `handle` carries the live (pre-bump)
  // gen; share its reference across buffers (EntityHandle is readonly so
  // aliasing can't be observed by mutation).
  if (columnHas.position(world, handle.id)) {
    world.removed.position.push(handle);
  }
  if (columnHas.actor(world, handle.id)) {
    world.removed.actor.push(handle);
  }
  if (columnHas.hp(world, handle.id)) {
    world.removed.hp.push(handle);
  }
  removeFromColumn(world.position, handle.id);
  removeFromColumn(world.actor, handle.id);
  removeFromColumn(world.hp, handle.id);
  // Bump to odd ⇒ marks slot as dead under the parity encoding.
  world.generations.set(handle.id, handle.gen + 1);
  world.recycled.push(handle.id);
}

export function getComponent<K extends ComponentKey>(
  world: World,
  handle: EntityHandle,
  key: K,
): Components[K] | undefined {
  if (!isLiveHandle(world, handle)) return undefined;
  return columnReaders[key](world, handle.id);
}

export function setComponent<K extends ComponentKey>(
  world: World,
  handle: EntityHandle,
  key: K,
  value: NonNullable<Components[K]>,
): void {
  if (!isLiveHandle(world, handle)) return;
  // Only count transitions absent → present as enters. Re-writes (set on
  // an already-bound key, e.g. moving an entity each tick) do not push.
  const hadBefore = columnHas[key](world, handle.id);
  columnWriters[key](world, handle.id, value);
  if (!hadBefore) world.added[key].push(handle);
}

export function removeComponent<K extends ComponentKey>(
  world: World,
  handle: EntityHandle,
  key: K,
): void {
  if (!isLiveHandle(world, handle)) return;
  if (!columnHas[key](world, handle.id)) return;
  world.removed[key].push(handle);
  columnRemovers[key](world, handle.id);
}

// Drain APIs — return the buffered handles and clear the buffer. Handles
// (not bare ids) so the consumer can `isLiveHandle` the result and detect
// despawn-recycle races between push and drain. Shallow-copy slice of the
// buffer: EntityHandle is readonly, callers can't mutate the shared refs.
export function drainEntered<K extends ComponentKey>(
  world: World,
  key: K,
): EntityHandle[] {
  const buf = world.added[key];
  if (buf.length === 0) return [];
  const out = buf.slice();
  buf.length = 0;
  return out;
}

export function drainExited<K extends ComponentKey>(
  world: World,
  key: K,
): EntityHandle[] {
  const buf = world.removed[key];
  if (buf.length === 0) return [];
  const out = buf.slice();
  buf.length = 0;
  return out;
}

// Internal — used by query.ts. Not exported from the barrel.
export function readByKey<K extends ComponentKey>(
  world: World,
  key: K,
  id: EntityId,
): Components[K] | undefined {
  return columnReaders[key](world, id);
}

export function sizeOfColumn<K extends ComponentKey>(
  world: World,
  key: K,
): number {
  return columnSizes[key](world);
}

// Internal — used by query.ts for `with`/`without` filters. Returns whether
// the entity currently has a value bound for `key`; does not read the value.
export function hasByKey<K extends ComponentKey>(
  world: World,
  key: K,
  id: EntityId,
): boolean {
  return columnHas[key](world, id);
}

// Internal — used by query.ts. Single-pass SoA snapshot of (id, gen) pairs in
// dense iteration order. Pairs (not bare ids) so that "despawn-then-respawn
// the same slot mid-iter" yields the impostor as a stale entity (gen mismatch)
// rather than as the original. Parallel `number[]`s (not `{id, gen}[]`) so
// we don't pay N object allocations per query.
export function denseSnapshotOf<K extends ComponentKey>(
  world: World,
  key: K,
): { ids: EntityId[]; gens: Generation[] } {
  return columnSnapshots[key](world);
}

// ─── Snapshot / restore ──────────────────────────────────────────────────────
//
// Plain-data, JSON-roundtrip-safe representation of a World. Used for save /
// replay and for hash-based regression tests. Round-trips byte-equal: same
// snapshot → restore → same internal state.

export type SerializableLifecycle = {
  readonly position: ReadonlyArray<readonly [EntityId, Generation]>;
  readonly actor: ReadonlyArray<readonly [EntityId, Generation]>;
  readonly hp: ReadonlyArray<readonly [EntityId, Generation]>;
};

// Serialized event channels: array of [channelName, eventList] pairs.
// Event payloads are unknown at the storage layer — callers reproduce the
// type at drain time via their `EventChannel<T>`. Survives JSON round-trip
// if every payload is JSON-safe (the channel owner's responsibility).
export type SerializableEvents = ReadonlyArray<
  readonly [string, readonly unknown[]]
>;

export type SerializableWorld = {
  readonly position: ReadonlyArray<readonly [EntityId, Position]>;
  readonly actor: ReadonlyArray<readonly [EntityId, Actor]>;
  readonly hp: ReadonlyArray<readonly [EntityId, HP]>;
  readonly generations: ReadonlyArray<readonly [EntityId, Generation]>;
  readonly nextId: EntityId;
  readonly recycled: readonly EntityId[];
  readonly added: SerializableLifecycle;
  readonly removed: SerializableLifecycle;
  readonly events: SerializableEvents;
};

export function snapshot(world: World): SerializableWorld {
  return {
    position: world.position.dense.map((e) => [
      e.id,
      cloneAndValidatePosition(e.v),
    ]),
    actor: world.actor.dense.map((e) => [e.id, cloneActor(e.v)]),
    hp: world.hp.dense.map((e) => [e.id, cloneAndValidateHP(e.v)]),
    generations: Array.from(world.generations.entries()),
    nextId: world.nextId,
    recycled: [...world.recycled],
    added: {
      position: world.added.position.map((h) => [h.id, h.gen]),
      actor: world.added.actor.map((h) => [h.id, h.gen]),
      hp: world.added.hp.map((h) => [h.id, h.gen]),
    },
    removed: {
      position: world.removed.position.map((h) => [h.id, h.gen]),
      actor: world.removed.actor.map((h) => [h.id, h.gen]),
      hp: world.removed.hp.map((h) => [h.id, h.gen]),
    },
    // Empty buckets are dropped: snapshot stays tight when channels have
    // been drained, and prevents bucket-name accumulation from bloating
    // the wire format. `drain` deletes the Map entry on its own so this
    // is mostly defensive against direct emit-then-clear sequences.
    events: serializeEventBuckets(world.events),
  };
}

function serializeEventBuckets(
  buckets: EventBuckets,
): readonly (readonly [string, readonly unknown[]])[] {
  const out: [string, unknown[]][] = [];
  for (const [k, v] of buckets) {
    if (v.length === 0) continue;
    out.push([k, [...v]]);
  }
  return out;
}

// Restore funnels every write through the per-key writers so component
// validation + cloning + future column invariants apply uniformly. Validates
// generation values up-front: a corrupted snapshot can plant gen ≥ 2^31
// where `stored + 1` rounds away and the parity check silently breaks.
// `columnWriters` themselves do NOT push to lifecycle buffers — those are
// rebuilt explicitly from the snapshot below so restore round-trips
// byte-equal without spurious enter/exit events.
export function restore(s: SerializableWorld): World {
  const w = emptyWorld();
  for (const [id, gen] of s.generations) {
    assertSafeGeneration(id, gen);
    w.generations.set(id, gen);
  }
  for (const [id, v] of s.position) columnWriters.position(w, id, v);
  for (const [id, v] of s.actor) columnWriters.actor(w, id, v);
  for (const [id, v] of s.hp) columnWriters.hp(w, id, v);
  w.nextId = s.nextId;
  for (const id of s.recycled) w.recycled.push(id);
  for (const [id, gen] of s.added.position) w.added.position.push({ id, gen });
  for (const [id, gen] of s.added.actor) w.added.actor.push({ id, gen });
  for (const [id, gen] of s.added.hp) w.added.hp.push({ id, gen });
  for (const [id, gen] of s.removed.position) {
    w.removed.position.push({ id, gen });
  }
  for (const [id, gen] of s.removed.actor) w.removed.actor.push({ id, gen });
  for (const [id, gen] of s.removed.hp) w.removed.hp.push({ id, gen });
  for (const [k, v] of s.events) w.events.set(k, [...v]);
  return w;
}
