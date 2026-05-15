import { DX4, DY4, getTile, inBounds, TILE_WALL } from "../dungeon/index";
import { type EntityHandle, getComponent, setComponent } from "../ecs/index";
import type { Rng } from "../rng/index";
import { activeLevel, activeWorld, entityAt, type GameState } from "./state";

/**
 * Resolve one turn for `handle` based on its `ai` component. Mutates the
 * active zone's world only — scheduling/turn cost is the caller's
 * responsibility. Callers must have verified `isLiveHandle` first.
 *
 * Returns `true` iff the entity acted (and should be rescheduled). `false`
 * means the entity has no `ai` component and the caller should drop it from
 * the scheduler — letting it stay would zombie a heap slot forever.
 */
export function runAi(
  state: GameState,
  rng: Rng,
  handle: EntityHandle,
): boolean {
  const world = activeWorld(state);
  const ai = getComponent(world, handle, "ai");
  if (ai === undefined) return false;
  switch (ai.kind) {
    case "wanderer":
      runWanderer(state, rng, handle);
      return true;
    default: {
      // Exhaustiveness — adding a new `Ai.kind` makes this a compile error,
      // forcing the new dispatcher to land alongside the new variant.
      const _exhaustive: never = ai.kind;
      throw new Error(`runAi: unhandled ai kind ${_exhaustive}`);
    }
  }
}

function runWanderer(state: GameState, rng: Rng, handle: EntityHandle): void {
  const world = activeWorld(state);
  const level = activeLevel(state);
  const pos = getComponent(world, handle, "position");
  // Defensive: a wanderer without a position can't move. Phase 2 only spawns
  // wanderers with position; if this fires, something further upstream is
  // broken — skip the turn silently rather than crash the tick.
  if (pos === undefined) return;
  const dir = rng.int(0, 3);
  const dx = DX4[dir];
  const dy = DY4[dir];
  if (dx === undefined || dy === undefined) {
    throw new Error(
      `runWanderer: rng.int(0, 3) returned ${dir} (out of range)`,
    );
  }
  const nx = pos.x + dx;
  const ny = pos.y + dy;
  if (!inBounds(nx, ny, level.grid)) return;
  if (getTile(level.grid, nx, ny) === TILE_WALL) return;
  if (entityAt(world, nx, ny) !== undefined) return;
  setComponent(world, handle, "position", { x: nx, y: ny });
}
