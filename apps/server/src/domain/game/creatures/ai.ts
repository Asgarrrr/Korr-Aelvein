import { DX4, DY4, getTile, inBounds, TILE_WALL } from "../../dungeon/index";
import {
  type EntityHandle,
  getComponent,
  sameHandle,
  setComponent,
} from "../../ecs/index";
import type { Rng } from "../../rng/index";
import { activeLevel, activeWorld, entityAt } from "../state";
import type { GameState } from "../types";
import { attack } from "./combat";

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
      throw new Error(
        `runAi: unhandled ai kind ${JSON.stringify(_exhaustive)}`,
      );
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
  const target = entityAt(world, nx, ny);
  if (target !== undefined) {
    // Bump-combat with restricted scope: a wanderer attacks only the
    // player. Wanderer-vs-wanderer (and, when concretised village NPCs
    // arrive, wanderer-vs-shopkeeper) stays a step refusal — no faction
    // or hostility component yet, so unprompted infighting would look
    // like a bug. When Phase 6+ introduces hostility relations, replace
    // the `sameHandle` check with the predicate.
    if (sameHandle(target, state.playerId)) {
      attack(world, rng, target);
    }
    return;
  }
  setComponent(world, handle, "position", { x: nx, y: ny });
}
