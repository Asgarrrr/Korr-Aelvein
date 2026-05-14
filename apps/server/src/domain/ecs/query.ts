// `query` vs `forQuery`, allocation cost, and the SoA-snapshot rationale:
// see `./README.md`. The one contract worth re-stating here because it's a
// runtime footgun: `forQuery`'s callback receives `handle` and `view`
// references that are reused across calls. The caller MUST NOT retain
// either past the callback's return.
//
// The four exports split by (pull/push) × (no-opts/with-opts) instead of
// overloading on the arg3 type. V8 inline-caches the call sites
// monomorphically when the function shape is stable; an overload on
// arg3 = QueryOpts | callback makes the function megamorphic in mixed-use
// programs (game systems calling both shapes pollute the same IC). Split
// API measures ~25 % faster on the filter path and ~8 % faster on the
// unfiltered path in the standard bench.

import type { ComponentKey, Components } from "./components";
import type { EntityHandle, EntityId, Generation } from "./entity";
import {
  denseSnapshotOf,
  hasByKey,
  isLiveHandle,
  readByKey,
  sizeOfColumn,
  type World,
} from "./world";

// `with` and `without` are post-filters: applied after pivot selection +
// liveness check, before projection. Pivot is always smallest-of-`keys` —
// `with` does not pull a smaller column into pivot consideration (locks
// pivot semantics so iteration order is predictable from the matched set).
export type QueryOpts = {
  readonly with?: readonly ComponentKey[];
  readonly without?: readonly ComponentKey[];
};

type View<K extends ComponentKey> = Required<Pick<Components, K>>;
type ForQueryCb<K extends ComponentKey> = (
  handle: EntityHandle,
  view: Readonly<View<K>>,
) => void;

// `const K` (TS 5+) narrows array-literal arguments to their tuple form, so
// `query(w, ["position"])` infers `K = readonly ["position"]` and the
// projected view is `Required<Pick<Components, "position">>`. Without it,
// the same call widens to `string[]` / `ComponentKey[]` and the view type
// would lie about which keys are present at runtime.

export function* query<const K extends readonly ComponentKey[]>(
  world: World,
  keys: K,
): Generator<readonly [EntityHandle, View<K[number]>]> {
  if (keys.length === 0) {
    throw new Error("query: at least one component key required");
  }
  const pivot = smallestColumn(world, keys);
  if (pivot === undefined) return;
  const { ids, gens } = denseSnapshotOf(world, pivot);
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i];
    const gen = gens[i];
    if (id === undefined || gen === undefined) continue;
    const handle: EntityHandle = { id, gen };
    if (!isLiveHandle(world, handle)) continue;
    const view = projectKeys<K[number]>(world, id, keys);
    if (view === undefined) continue;
    yield [handle, view];
  }
}

export function* queryFiltered<const K extends readonly ComponentKey[]>(
  world: World,
  keys: K,
  opts: QueryOpts,
): Generator<readonly [EntityHandle, View<K[number]>]> {
  if (keys.length === 0) {
    throw new Error("queryFiltered: at least one component key required");
  }
  const pivot = smallestColumn(world, keys);
  if (pivot === undefined) return;
  const without = opts.without;
  const withKeys = opts.with;
  const { ids, gens } = denseSnapshotOf(world, pivot);
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i];
    const gen = gens[i];
    if (id === undefined || gen === undefined) continue;
    const handle: EntityHandle = { id, gen };
    if (!isLiveHandle(world, handle)) continue;
    if (without !== undefined && hasAnyKey(world, id, without)) continue;
    if (withKeys !== undefined && !hasAllKeys(world, id, withKeys)) continue;
    const view = projectKeys<K[number]>(world, id, keys);
    if (view === undefined) continue;
    yield [handle, view];
  }
}

export function forQuery<const K extends readonly ComponentKey[]>(
  world: World,
  keys: K,
  cb: ForQueryCb<K[number]>,
): void {
  if (keys.length === 0) {
    throw new Error("forQuery: at least one component key required");
  }
  const pivot = smallestColumn(world, keys);
  if (pivot === undefined) return;
  const { ids, gens } = denseSnapshotOf(world, pivot);
  const handle: { id: EntityId; gen: Generation } = { id: 0, gen: 0 };
  const view: Partial<Pick<Components, K[number]>> = {};
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i];
    const gen = gens[i];
    if (id === undefined || gen === undefined) continue;
    handle.id = id;
    handle.gen = gen;
    if (!isLiveHandle(world, handle)) continue;
    if (!fillView<K[number]>(world, id, keys, view)) continue;
    cb(handle, view);
  }
}

export function forQueryFiltered<const K extends readonly ComponentKey[]>(
  world: World,
  keys: K,
  opts: QueryOpts,
  cb: ForQueryCb<K[number]>,
): void {
  if (keys.length === 0) {
    throw new Error("forQueryFiltered: at least one component key required");
  }
  const pivot = smallestColumn(world, keys);
  if (pivot === undefined) return;
  const without = opts.without;
  const withKeys = opts.with;
  const { ids, gens } = denseSnapshotOf(world, pivot);
  const handle: { id: EntityId; gen: Generation } = { id: 0, gen: 0 };
  const view: Partial<Pick<Components, K[number]>> = {};
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i];
    const gen = gens[i];
    if (id === undefined || gen === undefined) continue;
    handle.id = id;
    handle.gen = gen;
    if (!isLiveHandle(world, handle)) continue;
    if (without !== undefined && hasAnyKey(world, id, without)) continue;
    if (withKeys !== undefined && !hasAllKeys(world, id, withKeys)) continue;
    if (!fillView<K[number]>(world, id, keys, view)) continue;
    cb(handle, view);
  }
}

function hasAllKeys(
  world: World,
  id: EntityId,
  keys: readonly ComponentKey[],
): boolean {
  for (const k of keys) if (!hasByKey(world, k, id)) return false;
  return true;
}

function hasAnyKey(
  world: World,
  id: EntityId,
  keys: readonly ComponentKey[],
): boolean {
  for (const k of keys) if (hasByKey(world, k, id)) return true;
  return false;
}

// Fills `view` in place. Returns true iff every requested key is present;
// the type predicate narrows `view` to the non-optional shape on success,
// so callers (`query` via a fresh `{}`, `forQuery` via a reused view) receive
// the right type without a cast.
// Helpers operate on `K extends ComponentKey` (the union of literal keys)
// rather than `K extends readonly ComponentKey[]` (the tuple). The public
// signatures use the tuple form for `const K` narrowing; inference flows
// `tuple K → K[number]` into these helpers without a cast.

function fillView<K extends ComponentKey>(
  world: World,
  id: number,
  keys: readonly K[],
  view: Partial<Pick<Components, K>>,
): view is Required<Pick<Components, K>> {
  for (const key of keys) {
    const v = readByKey(world, key, id);
    if (v === undefined) return false;
    view[key] = v;
  }
  return true;
}

function projectKeys<K extends ComponentKey>(
  world: World,
  id: number,
  keys: readonly K[],
): Required<Pick<Components, K>> | undefined {
  const out: Partial<Pick<Components, K>> = {};
  return fillView(world, id, keys, out) ? out : undefined;
}

function smallestColumn<K extends ComponentKey>(
  world: World,
  keys: readonly K[],
): K | undefined {
  let pivot: K | undefined;
  let pivotSize = Number.POSITIVE_INFINITY;
  for (const key of keys) {
    const size = sizeOfColumn(world, key);
    if (size === 0) return undefined; // no entity can match
    if (size < pivotSize) {
      pivotSize = size;
      pivot = key;
    }
  }
  return pivot;
}
