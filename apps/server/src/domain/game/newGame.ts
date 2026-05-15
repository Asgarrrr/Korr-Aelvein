/**
 * Game initialisation. The single public entry point is `newGame(seed,
 * style)`, which assembles two symmetric pieces:
 *
 *  - `spawnDonjonZone` — the active starting zone with the player and a
 *    handful of wanderer mobs.
 *  - `spawnVillageZone` — a dormant zone with a shopkeeper NPC running on
 *    the global schedule heap.
 *
 * Tuning constants (zone ids, mob count, schedule cadence) live at the top
 * so the factory body stays a recipe rather than a soup of literals.
 */

import {
  generateLevel,
  getTile,
  type Level,
  type StyleId,
  TILE_WALL,
} from "../dungeon/index";
import { emptyWorld, spawn } from "../ecs/index";
import { createRng, type Rng } from "../rng/index";
import { emptyScheduler, type Scheduler, schedule } from "../scheduler/index";
import type { GameState, GlobalEvent, ZoneId, ZoneStatus } from "./types";

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

/**
 * Build a fresh GameState from a seed and a dungeon style. Donjon is active,
 * village is dormant. The single sfc32 stream threads through every spawn
 * and schedule call in deterministic order — the very same `(seed, style)`
 * input must always produce the same heap, the same wanderer positions, the
 * same villager waypoints.
 */
export function newGame(seed: number, style: StyleId): GameState {
  const rng = createRng(seed);
  const globalScheduler = emptyScheduler<GlobalEvent>();
  const zones = new Map<ZoneId, ZoneStatus>();

  const playerId = spawnDonjonZone(rng, style, zones, globalScheduler);
  spawnVillageZone(rng, zones, globalScheduler);

  return {
    zones,
    activeZone: DONJON_ZONE,
    playerId,
    globalScheduler,
    rngState: rng.state(),
    time: 0,
    turn: 0,
    gameOver: false,
  };
}

/**
 * Populate the donjon (active) zone: player at the level's spawn point,
 * `WANDERER_COUNT` wanderers placed on random distinct floor cells. All
 * three are scheduled at `time=0` — the player's `seq=0` wins the FIFO
 * tiebreak so it always acts first on turn 1.
 */
function spawnDonjonZone(
  rng: Rng,
  style: StyleId,
  zones: Map<ZoneId, ZoneStatus>,
  globalScheduler: Scheduler<GlobalEvent>,
): GameState["playerId"] {
  const level = generateLevel(rng, 80, 30, style);
  if (level.spawn === null) {
    throw new Error("spawnDonjonZone: generated level has no spawn point");
  }
  const [px, py] = level.spawn;
  const world = emptyWorld();
  const playerId = spawn(world, {
    position: { x: px, y: py },
    actor: { glyph: "@", name: "you" },
    hp: { current: 10, max: 10 },
  });
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
      hp: { current: 3, max: 3 },
    });
    schedule(globalScheduler, 0, {
      kind: "actor",
      zone: DONJON_ZONE,
      entity: wanderer,
    });
    taken.add(cellKey(wx, wy));
  }

  zones.set(DONJON_ZONE, { kind: "active", world, level });
  return playerId;
}

/**
 * Populate the village (dormant) zone: one shopkeeper NPC with a 2-waypoint
 * schedule (home, counter), the first schedule event queued at
 * `t = VILLAGE_SCHEDULE_PERIOD`. The villager never enters the active-zone
 * AI dispatch — every transition flows through the abstract resolver.
 */
function spawnVillageZone(
  rng: Rng,
  zones: Map<ZoneId, ZoneStatus>,
  globalScheduler: Scheduler<GlobalEvent>,
): void {
  const level = generateLevel(rng, 40, 20, "rim");
  const world = emptyWorld();
  const floors = listFloorCells(level);
  if (floors.length < 2) {
    throw new Error(
      "spawnVillageZone: village level has fewer than 2 floor cells",
    );
  }
  const taken = new Set<string>();
  // Reserve `level.spawn` for the arriving player. `enterZone`
  // pre-computes the player's spawn cell *before* `concretize` runs
  // catchupDormant — if a Schedule waypoint included `level.spawn`,
  // catchup could move an NPC onto the pre-computed cell and the player
  // would land on top of them on entry.
  if (level.spawn !== null) {
    taken.add(cellKey(level.spawn[0], level.spawn[1]));
  }
  const homeCell = pickFreeFloor(rng, floors, taken);
  taken.add(cellKey(homeCell[0], homeCell[1]));
  const counterCell = pickFreeFloor(rng, floors, taken);
  const villager = spawn(world, {
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
    world,
    level,
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
