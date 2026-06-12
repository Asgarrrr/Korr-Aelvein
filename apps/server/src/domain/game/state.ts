/**
 * Runtime accessors over `GameState`. Pure reads only — no factory, no
 * mutation. The shape and the factory live in `./types` and `./newGame`
 * respectively; everything here is what the reducer and the WS handler
 * call when they need to *see* the current state.
 */

import type { Level } from "../dungeon/index";
import type { EntityHandle, World } from "../ecs/index";
import { query } from "../ecs/index";
import type { GameState, ZoneId, ZoneStatus } from "./types";

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
 * (audited 2026-05); the planned upgrade is a flat-index
 * `Map<number, EntityHandle>` (keyed by `idx(x, y, width)`) maintained in
 * `setComponent("position")` once bump-combat or actor count forces it.
 */
export function entityAt(
  world: World,
  x: number,
  y: number,
): EntityHandle | undefined {
  for (const [handle, view] of query(world, ["position", "actor"])) {
    const p = view.position;
    if (p.x === x && p.y === y) return handle;
  }
  return undefined;
}
