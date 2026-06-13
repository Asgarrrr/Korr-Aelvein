// Public facade for the world/ sub-module. See ../README.md for architecture.

import {
  COMPONENT_KEYS,
  type ComponentKey,
  type Components,
} from "../components";
import type { EntityHandle, EntityId, Generation } from "../entity";
import {
  columnHas,
  columnReaders,
  columnRemovers,
  columnSizes,
  columnSnapshots,
  columnWriters,
} from "./dispatch";
import type { World } from "./types";

export { emptyWorld, type World } from "./types";

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

function allocId(world: World): EntityId {
  const reuse = world.recycled.pop();
  if (reuse !== undefined) return reuse;
  const id = world.nextId;
  world.nextId = id + 1;
  return id;
}

// Write one present column for a fresh slot, returning whether a value was
// there (so the caller logs the enter only on a real add). Captured as a single
// type parameter `K`, the mapped-table index `columnWriters[key]` narrows to
// one writer and `c[key]` to one value type — the no-`as` way to fan out over
// a key union. A loop with a *union*-typed key instead would force the value to
// the intersection of every component type, which only an `as` compiles, and
// `as` is banned (the wall `restore` hits too — see world/snapshot.ts).
function writeColumn<K extends ComponentKey>(
  world: World,
  id: EntityId,
  c: Components,
  key: K,
): boolean {
  const value = c[key];
  if (value === undefined) return false;
  columnWriters[key](world, id, value);
  return true;
}

// Removal correlates nothing (removers/has-checks take only an id), so a plain
// union key suffices: log the exit only for columns the entity actually held,
// then remove.
function clearColumn(
  world: World,
  handle: EntityHandle,
  key: ComponentKey,
): void {
  if (columnHas[key](world, handle.id)) world.removed[key].push(handle);
  columnRemovers[key](world, handle.id);
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
  // One pass over the canonical key list: each present value routes through
  // `columnWriters` (the value chokepoint) via the correlated generic above.
  // Writing directly instead of via `setComponent` skips its isLiveHandle +
  // hadBefore checks, both provably redundant for a freshly allocated slot.
  for (const key of COMPONENT_KEYS) {
    if (writeColumn(world, id, c, key)) world.added[key].push(handle);
  }
  return handle;
}

export function despawn(world: World, handle: EntityHandle): void {
  if (!isLiveHandle(world, handle)) return;
  // For each column the entity holds: push to `removed` BEFORE the actual
  // remove so spurious "removed X" events don't fire for columns the entity
  // never had. The caller's `handle` carries the live (pre-bump) gen; share
  // its reference across buffers (EntityHandle is readonly so aliasing
  // can't be observed). Per-key routes through the dispatch tables, same
  // chokepoint as `removeComponent` below.
  for (const key of COMPONENT_KEYS) clearColumn(world, handle, key);
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

// Internal — used by query.ts. Not exported from the ECS barrel.
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

// Internal — used by query.ts. Single-pass SoA snapshot of (id, gen) pairs
// in dense iteration order. Pairs (not bare ids) so that
// "despawn-then-respawn the same slot mid-iter" yields the impostor as a
// stale entity (gen mismatch) rather than as the original. Parallel
// `number[]`s (not `{id, gen}[]`) so we don't pay N object allocations per
// query.
export function denseSnapshotOf<K extends ComponentKey>(
  world: World,
  key: K,
): { ids: EntityId[]; gens: Generation[] } {
  return columnSnapshots[key](world);
}
