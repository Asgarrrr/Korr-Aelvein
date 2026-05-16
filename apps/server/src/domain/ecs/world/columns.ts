// Sparse-set column primitives. AoS storage (`dense: ComponentEntry<T>[]`)
// + `sparse: Map<EntityId, number>` for O(1) lookup. Invariant:
// `dense.length === sparse.size`.

import type { EntityId, Generation } from "../entity";

export type ComponentEntry<T> = {
  readonly id: EntityId;
  readonly v: T;
};

export type ComponentColumn<T> = {
  readonly dense: ComponentEntry<T>[];
  readonly sparse: Map<EntityId, number>;
};

export function emptyColumn<T>(): ComponentColumn<T> {
  return { dense: [], sparse: new Map() };
}

export function readFromColumn<T>(
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

export function setInColumn<T>(
  col: ComponentColumn<T>,
  id: EntityId,
  v: T,
): void {
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
export function removeFromColumn<T>(
  col: ComponentColumn<T>,
  id: EntityId,
): void {
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

// SoA single-pass snapshot of (id, gen) pairs in dense order. Used by
// `query.ts` so that mutating the iterated column mid-query doesn't corrupt
// iteration AND so we don't allocate N temporary `{id, gen}` objects per
// query call. Parallel `number[]`s, not `{id, gen}[]`.
export function snapshotColumn<T>(
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
