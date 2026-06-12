/**
 * Glue between the pure FOV algorithm (`domain/perception`) and the
 * zone-level perception memory (`ZoneStatus.seen` / `.visible`).
 *
 * Perception is zone state, not an ECS component: it must survive the
 * player's despawn/respawn across `enterZone` (the player entity rotates,
 * the zone's map memory doesn't). Revisit as a per-entity component when
 * mobs get their own line-of-sight (pursuit AI).
 *
 * Consumes no RNG — determinism tests that pin `rngState` sequences must
 * not move when perception lands.
 *
 * Caveat: perception is recomputed ONLY on player movement (accepted step,
 * `newGame`, zone arrival). TODO(door-state): the day door open/close state
 * lands (`isOpaque` in `domain/perception` is the chokepoint), any action
 * that flips a door MUST also call `updatePerception` from the player's
 * current position — otherwise the FOV stays stale until the next step.
 */

import { computeFov } from "../perception/index";
import type { ZoneStatus } from "./types";

/**
 * Sight radius in tiles (euclidean). 12 comfortably out-ranges the 80×30
 * donjon's room sizes; métiers (pillar 2) will later modulate this
 * per-profession.
 */
export const VISION_RADIUS = 12;

/**
 * Recompute the player's FOV from `(x, y)` and fold it into the zone's
 * memory: `visible` is overwritten in place, `seen` accumulates (bitwise
 * OR — a seen tile never becomes unseen). Call on every player move and
 * on zone entry; positions that don't change don't need a call.
 *
 * The FOV is computed against `zone.level` rather than a caller-supplied
 * level: passing a level that isn't the zone's own would compute a
 * wrong-size FOV mask, and the OR into `seen` would silently no-op
 * out-of-bounds on the Uint8Array — a silent-corruption footgun.
 */
export function updatePerception(
  zone: ZoneStatus,
  x: number,
  y: number,
  radius: number,
): void {
  const fov = computeFov(zone.level, x, y, radius);
  zone.visible.set(fov);
  const seen = zone.seen;
  for (const [i, v] of fov.entries()) {
    if (v === 1) seen[i] = 1;
  }
}
