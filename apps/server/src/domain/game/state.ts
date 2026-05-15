import {
  generateLevel,
  getTile,
  type Level,
  type StyleId,
  TILE_WALL,
} from "../dungeon/index";
import {
  type EntityHandle,
  emptyWorld,
  query,
  spawn,
  type World,
} from "../ecs/index";
import { createRng, type Rng, type RngState } from "../rng/index";
import { emptyScheduler, type Scheduler, schedule } from "../scheduler/index";

/**
 * Zone identifier. Plain `number` rather than a branded type — the project
 * avoids branded types because constructing them requires `as`, which is
 * banned. `ZoneId` is documentation: integer keys into `GameState.zones`.
 */
export type ZoneId = number;

/** Monotonic game-time in scheduler ticks. */
export type Time = number;

/**
 * Per-zone state. Phase 3 only ever has active zones, so `ZoneStatus` is a
 * single shape with no discriminant. Phase 4 will introduce the discriminator
 * and a `dormant` variant — that shape (whether it keeps `World` or replaces
 * it with an actor summary) will be decided from real evidence then, not
 * pre-committed here.
 */
export type ZoneStatus = {
  readonly world: World;
  readonly level: Level;
};

/**
 * Discriminated union of every event class on the global timeline. Phase 3
 * carries a single variant — actor turns. Phase 4 will extend it with
 * `schedule` (abstract NPC activity) and `world` (weather, time-of-day,
 * etc.). The drain dispatch uses a `never` exhaustiveness sentinel so new
 * variants force a compile-error on dispatch sites that haven't caught up.
 */
export type GlobalEvent = {
  readonly kind: "actor";
  readonly zone: ZoneId;
  readonly actor: EntityHandle;
};

/**
 * GameState — the multi-zone shape.
 *
 * Single-zone Phase 1/2 has been lifted into a `Map<ZoneId, ZoneStatus>`
 * with one entry. The previous single `scheduler` field has been renamed to
 * `globalScheduler` and now carries `GlobalEvent` payloads. The previous
 * `scheduler.now` reading of game-time has been promoted to `time` at the
 * `GameState` level — once the heap routes events for several zones the
 * heap's local `now` ceases to be a meaningful clock by itself.
 *
 * `time` is set to `globalScheduler.now` at end of tick — i.e. the time of
 * the most recently popped event. When the drain ran non-player events, it
 * is the last drained event's time; when the player was the only actor, it
 * is the player's own pop time *of this tick*, which lags one turn behind
 * the player's next slot. `time` is not the time of the player's *next*
 * turn.
 *
 * Mutation model is unchanged: the `GameState` literal rotates per tick
 * (new `rngState`, new `time`, `turn + 1`); the `zones` map, each zone's
 * `World` columns, and `globalScheduler.heap` are mutated in place.
 */
export type GameState = {
  readonly zones: Map<ZoneId, ZoneStatus>;
  readonly activeZone: ZoneId;
  readonly playerId: EntityHandle;
  readonly globalScheduler: Scheduler<GlobalEvent>;
  readonly rngState: RngState;
  readonly time: Time;
  readonly turn: number;
};

const DONJON_ZONE: ZoneId = 0;
const WANDERER_COUNT = 2;

export function newGame(seed: number, style: StyleId): GameState {
  const rng = createRng(seed);
  const level = generateLevel(rng, 80, 30, style);
  if (level.spawn === null) {
    throw new Error("newGame: generated level has no spawn point");
  }
  const [px, py] = level.spawn;
  const world = emptyWorld();
  const playerId = spawn(world, {
    position: { x: px, y: py },
    actor: { glyph: "@", name: "you" },
    hp: { current: 10, max: 10 },
  });
  const globalScheduler = emptyScheduler<GlobalEvent>();
  // Player at seq=0 — same time as wanderers below, but lower seq wins the
  // FIFO tiebreak so the player always acts first on turn 1.
  schedule(globalScheduler, 0, {
    kind: "actor",
    zone: DONJON_ZONE,
    actor: playerId,
  });

  const floors = listFloorCells(level);
  const taken = new Set<string>([cellKey(px, py)]);
  for (let i = 0; i < WANDERER_COUNT; i++) {
    const [wx, wy] = pickFreeFloor(rng, floors, taken);
    const wanderer = spawn(world, {
      position: { x: wx, y: wy },
      actor: { glyph: "r", name: "wanderer" },
      ai: { kind: "wanderer" },
    });
    schedule(globalScheduler, 0, {
      kind: "actor",
      zone: DONJON_ZONE,
      actor: wanderer,
    });
    taken.add(cellKey(wx, wy));
  }

  const zones = new Map<ZoneId, ZoneStatus>();
  zones.set(DONJON_ZONE, { world, level });

  return {
    zones,
    activeZone: DONJON_ZONE,
    playerId,
    globalScheduler,
    rngState: rng.state(),
    time: 0,
    turn: 0,
  };
}

function cellKey(x: number, y: number): string {
  return `${x},${y}`;
}

function listFloorCells(level: Level): Array<readonly [number, number]> {
  const { width, height } = level.grid;
  const out: Array<readonly [number, number]> = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (getTile(level.grid, x, y) !== TILE_WALL) out.push([x, y]);
    }
  }
  return out;
}

function pickFreeFloor(
  rng: Rng,
  floors: ReadonlyArray<readonly [number, number]>,
  taken: ReadonlySet<string>,
): readonly [number, number] {
  // Single allocation, one rng.pick — no rejection loop, no determinism trap
  // from variable-length RNG consumption.
  const available = floors.filter(([x, y]) => !taken.has(cellKey(x, y)));
  if (available.length === 0) {
    throw new Error("pickFreeFloor: no floor cells available");
  }
  return rng.pick(available);
}

/**
 * Look up a zone by id. Throws if the id isn't in the map — internal
 * callers only; the only path to construct a bad id is to corrupt a save.
 */
export function getZone(state: GameState, id: ZoneId): ZoneStatus {
  const z = state.zones.get(id);
  if (z === undefined) {
    throw new Error(`getZone: unknown zone id ${id}`);
  }
  return z;
}

/** Resolve the active zone. Throws if `activeZone` is missing from `zones`. */
export function activeZoneStatus(state: GameState): ZoneStatus {
  return getZone(state, state.activeZone);
}

export function activeWorld(state: GameState): World {
  return activeZoneStatus(state).world;
}

export function activeLevel(state: GameState): Level {
  return activeZoneStatus(state).level;
}

/**
 * True if any live entity with `position + actor` occupies `(x, y)` in
 * `world`. Used by tick (player MOVE refusal) and ai (wanderer step
 * refusal) to enforce "one actor per tile". Takes `world` directly rather
 * than `GameState` so Phase 4 abstract resolvers can run it against a
 * dormant zone's columns.
 *
 * O(n) over `position + actor` entities. Fine below ~1000 actors per zone
 * (audited 2026-05); the planned upgrade is a `Map<cellKey, EntityHandle>`
 * maintained in `setComponent("position")` once bump-combat or actor count
 * forces it.
 */
export function cellBlocked(world: World, x: number, y: number): boolean {
  for (const [_handle, view] of query(world, ["position", "actor"])) {
    const p = view.position;
    if (p !== undefined && p.x === x && p.y === y) return true;
  }
  return false;
}
