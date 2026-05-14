/**
 * Stable identity for an entity. Numeric and dense — recycled after despawn.
 * Pair with `EntityHandle.gen` to detect stale handles that survive a save /
 * load across id recycling.
 */
export type EntityId = number;

/**
 * Generation counter for an `EntityId` slot. Starts at 0 on first spawn and
 * increments every time the slot is despawned. A handle whose `gen` no longer
 * matches the world's recorded gen for that id is stale and refers to a dead
 * incarnation — useful when long-lived references survive across save / load.
 */
export type Generation = number;

/**
 * Stable reference to a specific incarnation of an entity. Surfaced to user
 * code (systems, scripts, save format). Pass around freely; `isLiveHandle`
 * (in `world.ts`) is the only safe way to check whether the underlying entity
 * still exists.
 */
export type EntityHandle = {
  readonly id: EntityId;
  readonly gen: Generation;
};
