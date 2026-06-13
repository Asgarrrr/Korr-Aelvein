// Plain-data, JSON-roundtrip-safe representation of a World. Used for save /
// replay and for hash-based regression tests. Round-trips byte-equal: same
// snapshot → restore → same internal state.

import {
  COMPONENT_KEYS,
  type ComponentKey,
  type Components,
} from "../components";
import type { EntityId, Generation } from "../entity";
import { columnWriters } from "./dispatch";
import { emptyWorld, type World } from "./types";
import { assertSafeGeneration, columnCloners } from "./validation";

// Per-key handle log (entity-gained / entity-lost). Mapped over
// `ComponentKey` so a new column appears here automatically.
export type SerializableLifecycle = {
  readonly [K in ComponentKey]: ReadonlyArray<readonly [EntityId, Generation]>;
};

// Serialized event channels: array of [channelName, eventList] pairs.
// Event payloads are unknown at the storage layer — callers reproduce the
// type at drain time via their `EventChannel<T>`. Survives JSON round-trip
// if every payload is JSON-safe (the channel owner's responsibility).
export type SerializableEvents = ReadonlyArray<
  readonly [string, readonly unknown[]]
>;

// Per-key dense column dump (id, value pairs). Mapped over `ComponentKey`
// so the wire shape stays in sync with `Components` without manual edits.
type SerializableColumns = {
  readonly [K in ComponentKey]: ReadonlyArray<
    readonly [EntityId, NonNullable<Components[K]>]
  >;
};

export type SerializableWorld = SerializableColumns & {
  readonly generations: ReadonlyArray<readonly [EntityId, Generation]>;
  readonly nextId: EntityId;
  readonly recycled: readonly EntityId[];
  readonly added: SerializableLifecycle;
  readonly removed: SerializableLifecycle;
  readonly events: SerializableEvents;
};

// Pure `(handle) ⇒ [id, gen]` map used by both `added` and `removed`
// blocks. No per-key generic — TS can't correlate `world[K]` with
// `columnCloners[K]` through a generic without `as`, so the per-key
// dispatch happens at each call site below.
function serializeHandleLog(
  buf: ReadonlyArray<{ readonly id: EntityId; readonly gen: Generation }>,
): ReadonlyArray<readonly [EntityId, Generation]> {
  return buf.map((h) => [h.id, h.gen]);
}

export function snapshot(world: World): SerializableWorld {
  // Per-key explicit calls route through `columnCloners` — adding a new
  // component is a compile error at `columnCloners`' definition AND at the
  // `SerializableWorld` return type (mapped over `ComponentKey`), forcing a
  // new line here. Two chokepoints, no silent drop on round-trip.
  return {
    position: world.position.dense.map((e) => [
      e.id,
      columnCloners.position(e.v),
    ]),
    actor: world.actor.dense.map((e) => [e.id, columnCloners.actor(e.v)]),
    hp: world.hp.dense.map((e) => [e.id, columnCloners.hp(e.v)]),
    ai: world.ai.dense.map((e) => [e.id, columnCloners.ai(e.v)]),
    schedule: world.schedule.dense.map((e) => [
      e.id,
      columnCloners.schedule(e.v),
    ]),
    generations: Array.from(world.generations.entries()),
    nextId: world.nextId,
    recycled: [...world.recycled],
    added: {
      position: serializeHandleLog(world.added.position),
      actor: serializeHandleLog(world.added.actor),
      hp: serializeHandleLog(world.added.hp),
      ai: serializeHandleLog(world.added.ai),
      schedule: serializeHandleLog(world.added.schedule),
    },
    removed: {
      position: serializeHandleLog(world.removed.position),
      actor: serializeHandleLog(world.removed.actor),
      hp: serializeHandleLog(world.removed.hp),
      ai: serializeHandleLog(world.removed.ai),
      schedule: serializeHandleLog(world.removed.schedule),
    },
    // Empty buckets are dropped: snapshot stays tight when channels have
    // been drained, and prevents bucket-name accumulation from bloating
    // the wire format. `drain` deletes the Map entry on its own so this
    // is mostly defensive against direct emit-then-clear sequences.
    events: serializeEventBuckets(world.events),
  };
}

function serializeEventBuckets(
  buckets: Map<string, unknown[]>,
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
// Correlated generic so `columnWriters[K]` and the snapshot's per-K value type
// line up without an `as` — same technique as `spawn`'s writeColumn. Lets the
// column restore loop below fan out over the canonical key list in one place.
function restoreColumn<K extends ComponentKey>(
  world: World,
  id: EntityId,
  key: K,
  value: NonNullable<Components[K]>,
): void {
  columnWriters[key](world, id, value);
}

export function restore(s: SerializableWorld): World {
  const w = emptyWorld();
  for (const [id, gen] of s.generations) {
    assertSafeGeneration(id, gen);
    w.generations.set(id, gen);
  }
  for (const key of COMPONENT_KEYS) {
    for (const [id, value] of s[key]) restoreColumn(w, id, key, value);
  }
  w.nextId = s.nextId;
  for (const id of s.recycled) w.recycled.push(id);
  for (const key of COMPONENT_KEYS) {
    for (const [id, gen] of s.added[key]) w.added[key].push({ id, gen });
  }
  for (const key of COMPONENT_KEYS) {
    for (const [id, gen] of s.removed[key]) w.removed[key].push({ id, gen });
  }
  for (const [k, v] of s.events) w.events.set(k, [...v]);
  return w;
}
