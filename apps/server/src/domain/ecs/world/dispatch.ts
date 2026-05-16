// Per-key dispatch tables — the chokepoint that catches "added a column
// but forgot to wire it" at compile time. Architecture: see ../README.md.

import type { ComponentKey, Components } from "../components";
import type { EntityId, Generation } from "../entity";
import {
  readFromColumn,
  removeFromColumn,
  setInColumn,
  snapshotColumn,
} from "./columns";
import type { World } from "./types";
import {
  cloneActor,
  cloneAi,
  cloneAndValidateHP,
  cloneAndValidatePosition,
  cloneAndValidateSchedule,
} from "./validation";

// `World` is imported type-only — cycle with `./index` is fine, no runtime
// ref. The dispatch tables only touch `World[K]` (column fields) and
// `World.generations`; the rest of the `World` shape is unused here.

type ColumnReaders = {
  [K in ComponentKey]: (w: World, id: EntityId) => Components[K] | undefined;
};

export const columnReaders: ColumnReaders = {
  position: (w, id) => readFromColumn(w.position, id),
  actor: (w, id) => readFromColumn(w.actor, id),
  hp: (w, id) => readFromColumn(w.hp, id),
  ai: (w, id) => readFromColumn(w.ai, id),
  schedule: (w, id) => readFromColumn(w.schedule, id),
};

type ColumnWriters = {
  [K in ComponentKey]: (
    w: World,
    id: EntityId,
    v: NonNullable<Components[K]>,
  ) => void;
};

export const columnWriters: ColumnWriters = {
  position: (w, id, v) =>
    setInColumn(w.position, id, cloneAndValidatePosition(v)),
  actor: (w, id, v) => setInColumn(w.actor, id, cloneActor(v)),
  hp: (w, id, v) => setInColumn(w.hp, id, cloneAndValidateHP(v)),
  ai: (w, id, v) => setInColumn(w.ai, id, cloneAi(v)),
  schedule: (w, id, v) =>
    setInColumn(w.schedule, id, cloneAndValidateSchedule(v)),
};

type ColumnRemovers = {
  [K in ComponentKey]: (w: World, id: EntityId) => void;
};

export const columnRemovers: ColumnRemovers = {
  position: (w, id) => removeFromColumn(w.position, id),
  actor: (w, id) => removeFromColumn(w.actor, id),
  hp: (w, id) => removeFromColumn(w.hp, id),
  ai: (w, id) => removeFromColumn(w.ai, id),
  schedule: (w, id) => removeFromColumn(w.schedule, id),
};

type ColumnSizes = { [K in ComponentKey]: (w: World) => number };

export const columnSizes: ColumnSizes = {
  position: (w) => w.position.dense.length,
  actor: (w) => w.actor.dense.length,
  hp: (w) => w.hp.dense.length,
  ai: (w) => w.ai.dense.length,
  schedule: (w) => w.schedule.dense.length,
};

type ColumnHas = {
  [K in ComponentKey]: (w: World, id: EntityId) => boolean;
};

// Presence-only check. Skips reading the dense entry — query filters
// (`with`/`without`) only need "is this key bound?", not the value.
export const columnHas: ColumnHas = {
  position: (w, id) => w.position.sparse.has(id),
  actor: (w, id) => w.actor.sparse.has(id),
  hp: (w, id) => w.hp.sparse.has(id),
  ai: (w, id) => w.ai.sparse.has(id),
  schedule: (w, id) => w.schedule.sparse.has(id),
};

type ColumnSnapshot = {
  [K in ComponentKey]: (w: World) => {
    ids: EntityId[];
    gens: Generation[];
  };
};

export const columnSnapshots: ColumnSnapshot = {
  position: (w) => snapshotColumn(w.position.dense, w.generations),
  actor: (w) => snapshotColumn(w.actor.dense, w.generations),
  hp: (w) => snapshotColumn(w.hp.dense, w.generations),
  ai: (w) => snapshotColumn(w.ai.dense, w.generations),
  schedule: (w) => snapshotColumn(w.schedule.dense, w.generations),
};
