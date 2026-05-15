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
 * Per-zone state. Phase 4 introduces the discriminator with two arms:
 *
 * - `active`: the zone the player is currently in. Fine-grain tick, AI runs
 *   at action granularity, full ECS world hot.
 * - `dormant`: any other zone. The world is still resident (tiles, items,
 *   NPC components survive) but per-actor turns are *not* on the
 *   `globalScheduler` heap. Instead, those NPCs schedule themselves via
 *   `GlobalEvent.schedule` events that fire on a coarser cadence; the
 *   abstract resolver in `game/abstract.ts` mutates the dormant world's
 *   columns directly without spawning fine-grain AI.
 *
 * `lastSimAt` is the game-time of the last `schedule` event that fired for
 * this zone. Phase 5+ zone-entry catchup will rebase from here.
 *
 * The "summary" alternative (drop `world`, keep only an actor digest) is
 * deliberately not taken yet — at this scale the resident world cost is
 * negligible, and the active/dormant transition stays a no-op on the
 * component data.
 */
export type ZoneStatus =
  | {
      readonly kind: "active";
      readonly world: World;
      readonly level: Level;
    }
  | {
      readonly kind: "dormant";
      readonly world: World;
      readonly level: Level;
      /**
       * Game-time of the last `GlobalEvent.schedule` that fired against this
       * zone. Mutated in place by `drainNonPlayer` whenever an applied event
       * succeeds. Phase 6 zone-entry catchup will use this as the rebase
       * point — drain only events whose `time > lastSimAt` to bring the
       * dormant world up to game-`time` on concretization.
       *
       * Mutable by deliberate exception to the surrounding `readonly` so the
       * map value's identity stays stable across ticks (same pattern as
       * `World.nextId`).
       */
      lastSimAt: Time;
    };

/**
 * Discriminated union of every event class on the global timeline.
 *
 * - `actor`: a fine-grain turn for an in-bubble actor in the active zone.
 *   Drained through `runAi`. Phase 1-3 had this only.
 * - `schedule`: a coarse-grain trigger for a dormant-zone NPC. Drained
 *   through the abstract resolver in `game/abstract.ts`, which mutates the
 *   dormant zone's world columns and reschedules the next tick.
 *
 * Future: `world` (weather, time-of-day) lands when a use case appears.
 *
 * Every variant carries an `entity: EntityHandle` field — the entity this
 * event concerns. The `kind` discriminator narrows behaviour at dispatch,
 * but the payload shape stays uniform so Phase 6 zone-park can flip
 * `kind` without renaming fields per payload.
 *
 * The drain dispatch uses a `never` exhaustiveness sentinel so any new
 * variant forces a compile error on every dispatch site that hasn't caught
 * up.
 */
export type GlobalEvent =
  | {
      readonly kind: "actor";
      readonly zone: ZoneId;
      readonly entity: EntityHandle;
    }
  | {
      readonly kind: "schedule";
      readonly zone: ZoneId;
      readonly entity: EntityHandle;
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
  /**
   * Per-zone state, keyed by `ZoneId`. **Not JSON-safe** — `JSON.stringify`
   * produces `"zones": {}` for a `Map`. The future `snapshotGameState`
   * (Phase 5+ save / replay) must explicitly serialise via
   * `Array.from(state.zones)` and reconstruct via `new Map(entries)` on
   * restore. The `Map` shape is kept so the inner mutation model stays
   * identical to `World` (reference-stable, mutated in place).
   */
  readonly zones: Map<ZoneId, ZoneStatus>;
  readonly activeZone: ZoneId;
  readonly playerId: EntityHandle;
  readonly globalScheduler: Scheduler<GlobalEvent>;
  readonly rngState: RngState;
  readonly time: Time;
  readonly turn: number;
};

const DONJON_ZONE: ZoneId = 0;
const VILLAGE_ZONE: ZoneId = 1;
const WANDERER_COUNT = 2;
/**
 * Cadence at which the village shopkeeper's schedule fires. One application
 * = one waypoint transition (e.g. home → counter). Picked at 5× the basic
 * action cost so a player WAIT-spamming through it sees the position toggle
 * every 5 turns — enough to make the abstract pipeline observable in tests
 * without flooding the heap.
 */
const VILLAGE_SCHEDULE_PERIOD = 500;

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
    entity: playerId,
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
      entity: wanderer,
    });
    taken.add(cellKey(wx, wy));
  }

  const zones = new Map<ZoneId, ZoneStatus>();
  zones.set(DONJON_ZONE, { kind: "active", world, level });

  // Village zone — dormant from the start. The villager NPC schedules its
  // own position transitions through `GlobalEvent.schedule` events on the
  // global heap; the abstract resolver mutates this world's columns
  // without spawning fine-grain AI. Phase 5+ will let the player travel
  // here and concretise the zone.
  spawnVillageZone(rng, zones, globalScheduler);

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

function spawnVillageZone(
  rng: Rng,
  zones: Map<ZoneId, ZoneStatus>,
  globalScheduler: Scheduler<GlobalEvent>,
): void {
  const villageLevel = generateLevel(rng, 40, 20, "rim");
  const villageWorld = emptyWorld();
  const floors = listFloorCells(villageLevel);
  if (floors.length < 2) {
    throw new Error(
      "spawnVillageZone: village level has fewer than 2 floor cells",
    );
  }
  // Two distinct floor cells: home and counter. Picking sequentially with
  // an exclusion set keeps RNG consumption constant in the seed and avoids
  // the rejection-sampling determinism trap.
  const homeCell = rng.pick(floors);
  const counterCandidates = floors.filter(
    ([x, y]) => x !== homeCell[0] || y !== homeCell[1],
  );
  const counterCell = rng.pick(counterCandidates);
  const villager = spawn(villageWorld, {
    position: { x: homeCell[0], y: homeCell[1] },
    actor: { glyph: "v", name: "shopkeeper" },
    // `nextIndex = 1` means the next schedule event moves the villager to
    // waypoints[1] (the counter). After that it cycles back to 0 and the
    // following event moves them home.
    schedule: {
      waypoints: [homeCell, counterCell],
      nextIndex: 1,
      period: VILLAGE_SCHEDULE_PERIOD,
    },
  });
  schedule(globalScheduler, VILLAGE_SCHEDULE_PERIOD, {
    kind: "schedule",
    zone: VILLAGE_ZONE,
    entity: villager,
  });
  zones.set(VILLAGE_ZONE, {
    kind: "dormant",
    world: villageWorld,
    level: villageLevel,
    lastSimAt: 0,
  });
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

/**
 * Resolve the active zone, asserting the discriminant. Throws if the zone
 * the GameState says is active is in fact dormant — that's a state-machine
 * bug (zone transitions are atomic), not a recoverable condition.
 */
export function activeZoneStatus(state: GameState): ZoneStatus & {
  kind: "active";
} {
  const z = getZone(state, state.activeZone);
  if (z.kind !== "active") {
    throw new Error(
      `activeZoneStatus: zone ${state.activeZone} is ${z.kind}, not active`,
    );
  }
  return z;
}

export function activeWorld(state: GameState): World {
  return activeZoneStatus(state).world;
}

export function activeLevel(state: GameState): Level {
  return activeZoneStatus(state).level;
}

/**
 * Live entity with `position + actor` occupying `(x, y)` in `world`, or
 * `undefined` if the cell is free. Used by tick (player MOVE refusal /
 * Phase 5 bump-combat) and ai (wanderer step refusal) — the boolean
 * "is this cell blocked?" is the `=== undefined` check; the handle is
 * what bump-combat needs to identify the target without a second scan.
 *
 * O(n) over `position + actor` entities. Fine below ~1000 actors per zone
 * (audited 2026-05); the planned upgrade is a `Map<cellKey, EntityHandle>`
 * maintained in `setComponent("position")` once bump-combat or actor count
 * forces it.
 */
export function entityAt(
  world: World,
  x: number,
  y: number,
): EntityHandle | undefined {
  for (const [handle, view] of query(world, ["position", "actor"])) {
    const p = view.position;
    if (p !== undefined && p.x === x && p.y === y) return handle;
  }
  return undefined;
}
