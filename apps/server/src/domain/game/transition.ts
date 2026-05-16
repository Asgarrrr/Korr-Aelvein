/**
 * Zone transitions — park the active zone, concretize a dormant zone,
 * teleport the player across worlds.
 *
 * Phase 6 brings the dormant village and active donjon into rotation. On
 * ENTER_ZONE the parked zone freezes its in-bubble NPCs (their `actor`
 * events drop off the global heap; world state is preserved) and the
 * concretized zone rehydrates fresh `actor` events for every `ai` entity
 * at the current `state.time`. NPCs with only a `Schedule` (no `Ai`)
 * become inert while their zone is active; their `schedule` events are
 * dropped on concretize and the entity sits at its last-applied waypoint
 * until the zone is parked again.
 *
 * The full architectural commitment lives in `docs/LIVING-WORLD.md`.
 */

import { getTile, type Level, TILE_WALL } from "../dungeon/index";
import {
  despawn,
  getComponent,
  isLiveHandle,
  query,
  spawn,
  type World,
} from "../ecs/index";
import {
  drainWhere,
  pop,
  removeWhere,
  schedule,
  scheduleAt,
} from "../scheduler/index";
import { applyAbstract } from "./abstract";
import { activeWorld, entityAt, getZone } from "./state";
import type { GameState, ZoneId } from "./types";

/**
 * Convert the active zone `id` to dormant. Despawns the player from that
 * zone's world (the caller has already read whatever persistent components
 * need to be carried across), drops every `actor` event for `id` from the
 * global heap, then re-adds a `schedule` event for every entity in `id`'s
 * world that carries a `Schedule` component so it resumes cycling
 * abstractly during dormancy. Flips the zone status with
 * `lastSimAt = state.time`.
 *
 * Active-zone NPCs without a `Schedule` component freeze at their current
 * position — they receive no events at all until the zone is concretized
 * again. NPCs with a `Schedule` resume on a fresh `period`-tick clock from
 * park time; carry-over of the partial period spent in-bubble is *not*
 * tracked. That's the simplest contract; finer-grained pacing can land
 * when gameplay demands it.
 */
export function parkActiveZone(state: GameState, id: ZoneId): void {
  const zone = getZone(state, id);
  if (zone.kind !== "active") {
    throw new Error(`parkActiveZone: zone ${id} is ${zone.kind}, not active`);
  }
  if (isLiveHandle(zone.world, state.playerId)) {
    despawn(zone.world, state.playerId);
  }
  removeWhere(state.globalScheduler, (ev) => {
    const p = ev.payload;
    return p.kind === "actor" && p.zone === id;
  });
  for (const [handle, view] of query(zone.world, ["schedule"])) {
    const sched = view.schedule;
    if (sched === undefined) continue;
    schedule(state.globalScheduler, sched.period, {
      kind: "schedule",
      zone: id,
      entity: handle,
    });
  }
  state.zones.set(id, {
    kind: "dormant",
    world: zone.world,
    level: zone.level,
    lastSimAt: state.time,
  });
}

/**
 * Flip dormant zone `id` to active. One pass over the heap:
 *
 *  1. Drain every `schedule` event for `id` — both the due ones (`time <=
 *     state.time`, applied in `(time, seq)` order with `zone.lastSimAt`
 *     advancing to the highest applied time) and the not-yet-due tail (just
 *     dropped: once the zone is active these would throw in `drainNonPlayer`).
 *  2. Flip the zone, then schedule a fresh `actor` event at `state.time`
 *     for every entity in the zone's world with an `ai` component (resume
 *     in-bubble ticking).
 *
 * Does NOT spawn the player — that's the orchestrator's job, since only it
 * holds the persistent state being carried across.
 *
 * The drained-and-applied subset is mostly defensive in the current
 * architecture: `drainNonPlayer` processes dormant `schedule` events
 * continuously, so the only events catchup typically picks up are same-time-
 * as-the-player same-tick events the drain stopped just before. Pinning the
 * contract from `docs/LIVING-WORLD.md` keeps the design safe under future
 * drain refactors.
 */
export function concretize(state: GameState, id: ZoneId): void {
  const zone = getZone(state, id);
  if (zone.kind !== "dormant") {
    throw new Error(`concretize: zone ${id} is ${zone.kind}, not dormant`);
  }
  // Pinned contract from docs/LIVING-WORLD.md § "Concretizing a dormant zone":
  // drain every `schedule` event for `id`, simulate the window
  // `(zone.lastSimAt, state.time]` via `applyAbstract`, advance `lastSimAt`
  // only to the highest *applied* time. Both bounds are typically empty in
  // today's architecture (drainNonPlayer processes dormant events
  // continuously, so lastSimAt ≈ state.time at concretize time), but pinning
  // the contract here keeps the design safe if a future Phase moves to
  // deferred / lazy simulation — at which point lastSimAt becomes the
  // load-bearing resume point.
  drainWhere(
    state.globalScheduler,
    (ev) => {
      const p = ev.payload;
      return p.kind === "schedule" && p.zone === id;
    },
    (ev) => {
      if (ev.time > state.time) return;
      if (ev.time <= zone.lastSimAt) return;
      const period = applyAbstract(zone, ev.payload.entity);
      if (period === undefined) return;
      zone.lastSimAt = ev.time;
    },
  );
  state.zones.set(id, {
    kind: "active",
    world: zone.world,
    level: zone.level,
  });
  // schedule(_, 0, _) adds at `scheduler.now` which is `state.time` at this
  // point (drainWhere mutated the heap without popping, so `now` is
  // unchanged). Each AI entity therefore gets a fresh actor event at
  // `state.time` and fires before the player's next event scheduled at
  // `state.time + ACTION_COST`.
  for (const [handle] of query(zone.world, ["ai"])) {
    schedule(state.globalScheduler, 0, {
      kind: "actor",
      zone: id,
      entity: handle,
    });
  }
}

/**
 * Orchestrate one zone transition. Pops the player's current actor event,
 * parks the current zone, concretizes the target, spawns the player in the
 * new world, schedules the player's next actor event one `actionCost`
 * after the just-popped event's time, and returns a rotated `GameState`
 * wrapper with the new `activeZone` and `playerId`.
 *
 * Returns the same `state` reference (no turn cost, no RNG advance) for
 * gameplay refusals: same-zone target, *and* unknown zone id — the latter
 * matches the project's "validate at boundaries" stance, where the WS
 * client only sees zone ids the server has published via the snapshot, so
 * an off-list id is hostile input rather than corrupted server state.
 * Throws on a known-but-active target — the only active zone is
 * `state.activeZone`, so a second active is a state-machine bug.
 *
 * Hp is the only persistent player state carried across today. Future
 * inventory / xp / status effects extend this list in one place.
 *
 * **Turn-cost timing.** `playerNextTime` is captured *after* the player's
 * `pop` — at that point `scheduler.now` equals the popped event's `time`,
 * so `now + actionCost` is the same `T + actionCost` MOVE/WAIT would
 * schedule. Park, concretize, and `scheduleAt` never advance
 * `scheduler.now` (removeWhere + schedule(_, 0, _) are both push-only or
 * filter-only), so this captured value stays correct through the rest of
 * `enterZone`.
 *
 * **Atomicity note.** `findPlayerSpawnCell` runs *before* `parkActiveZone`
 * / `concretize` so a level-degeneracy throw can't poison the session's
 * `GameState`. The pre-computation reads only the target zone's `level`
 * and `world`, both stable until concretize's `catchupDormant` mutates
 * the world. `catchupDormant` only moves entities to their `Schedule`
 * waypoints; `spawnVillageZone` reserves `level.spawn` from waypoint
 * candidates so the pre-computed cell stays free across the transition.
 */
export function enterZone(
  state: GameState,
  target: ZoneId,
  actionCost: number,
): GameState {
  if (target === state.activeZone) return state;
  const targetZone = state.zones.get(target);
  if (targetZone === undefined) return state;
  if (targetZone.kind !== "dormant") {
    throw new Error(
      `enterZone: target zone ${target} is ${targetZone.kind}, not dormant`,
    );
  }
  const oldWorld = activeWorld(state);
  const hp = getComponent(oldWorld, state.playerId, "hp");
  if (hp === undefined) {
    throw new Error("enterZone: player has no hp component");
  }
  const spawnCell = findPlayerSpawnCell(targetZone.level, targetZone.world);
  pop(state.globalScheduler);
  const playerNextTime = state.globalScheduler.now + actionCost;
  parkActiveZone(state, state.activeZone);
  concretize(state, target);

  const newZone = getZone(state, target);
  if (newZone.kind !== "active") {
    throw new Error("enterZone: concretize failed to activate target");
  }
  const [px, py] = spawnCell;
  const newPlayerId = spawn(newZone.world, {
    position: { x: px, y: py },
    actor: { glyph: "@", name: "you" },
    hp,
  });
  scheduleAt(state.globalScheduler, playerNextTime, {
    kind: "actor",
    zone: target,
    entity: newPlayerId,
  });
  return {
    ...state,
    activeZone: target,
    playerId: newPlayerId,
  };
}

/**
 * Pick a free floor cell for the arriving player. Tries `level.spawn`
 * first; falls back to a deterministic row-major first-free scan when an
 * NPC has wandered onto the spawn cell.
 *
 * Row-major over `rng.pick` for the fallback so the choice doesn't burn
 * RNG mid-tick — pathological cases (every floor cell occupied) land
 * deterministically rather than depending on RNG state.
 */
function findPlayerSpawnCell(
  level: Level,
  world: World,
): readonly [number, number] {
  if (level.spawn !== null) {
    const [sx, sy] = level.spawn;
    if (entityAt(world, sx, sy) === undefined) return [sx, sy];
  }
  for (let y = 0; y < level.grid.height; y++) {
    for (let x = 0; x < level.grid.width; x++) {
      if (getTile(level.grid, x, y) === TILE_WALL) continue;
      if (entityAt(world, x, y) !== undefined) continue;
      return [x, y];
    }
  }
  throw new Error("findPlayerSpawnCell: zone has no free floor cells");
}
