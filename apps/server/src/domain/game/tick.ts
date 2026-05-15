import { getTile, inBounds, TILE_WALL } from "../dungeon/index";
import {
  type EntityHandle,
  getComponent,
  isLiveHandle,
  setComponent,
} from "../ecs/index";
import { fromRngState, type Rng } from "../rng/index";
import { peek, pop, schedule } from "../scheduler/index";
import { runAi } from "./ai";
import { cellBlocked, type GameState } from "./state";

export type Dir = "n" | "e" | "s" | "w";
export type Action =
  | { readonly type: "MOVE"; readonly dir: Dir }
  | { readonly type: "WAIT" };

/**
 * Base cost of a basic action in scheduler ticks. 1 "turn" = 100 ticks; speed
 * variants land naturally as smaller (fast) or larger (slow) costs in later
 * phases.
 */
const ACTION_COST = 100;

function dirDelta(dir: Dir): readonly [number, number] {
  if (dir === "n") return [0, -1];
  if (dir === "e") return [1, 0];
  if (dir === "s") return [0, 1];
  return [-1, 0]; // "w"
}

function sameHandle(a: EntityHandle, b: EntityHandle): boolean {
  return a.id === b.id && a.gen === b.gen;
}

export function tick(state: GameState, action: Action): GameState {
  if (!isLiveHandle(state.world, state.playerId)) {
    throw new Error("tick: player handle is stale (entity despawned)");
  }
  // Invariant: every inbound action arrives when the scheduler head is the
  // player. The drain loop at the bottom of every accepted tick re-establishes
  // it before returning, so the invariant survives across calls.
  const top = peek(state.scheduler);
  if (top === undefined) {
    throw new Error(
      "tick: scheduler is empty (newGame must schedule the player)",
    );
  }
  if (!sameHandle(top.handle, state.playerId)) {
    throw new Error("tick: scheduler head is not the player");
  }

  // Hydrate RNG once per accepted action. Returned `rng.state()` is persisted
  // back into the new GameState even when no rolls happened (cheap, and
  // guarantees a single source of truth for replay determinism).
  const rng = fromRngState(state.rngState);

  if (action.type === "MOVE") {
    const pos = getComponent(state.world, state.playerId, "position");
    if (pos === undefined) {
      throw new Error("tick: player entity is missing the position component");
    }
    const [dx, dy] = dirDelta(action.dir);
    const nx = pos.x + dx;
    const ny = pos.y + dy;
    // Refused inputs do not consume the player's turn: keep heap, world,
    // rngState, and turn untouched; return the same wrapper for fast-eq.
    if (!inBounds(nx, ny, state.level.grid)) return state;
    if (getTile(state.level.grid, nx, ny) === TILE_WALL) return state;
    // Phase 3 will replace this branch with an ATTACK action (bump-combat).
    if (cellBlocked(state, nx, ny)) return state;
    pop(state.scheduler);
    setComponent(state.world, state.playerId, "position", { x: nx, y: ny });
    schedule(state.scheduler, ACTION_COST, state.playerId);
  } else {
    // WAIT — no validation can refuse it; spend the turn.
    pop(state.scheduler);
    schedule(state.scheduler, ACTION_COST, state.playerId);
  }

  drainNonPlayer(state, rng);

  return {
    ...state,
    rngState: rng.state(),
    turn: state.turn + 1,
  };
}

/**
 * Pop every non-player event up to (but not including) the next player slot.
 * Stale entries are skipped lazily — they advance `scheduler.now` to their
 * `time` (game-time invariant) but are not dispatched or re-scheduled.
 * Entities whose `ai` component has been stripped (despawn race, future
 * status effects) drop out of the heap rather than zombie-cycle forever.
 */
function drainNonPlayer(state: GameState, rng: Rng): void {
  while (true) {
    const next = peek(state.scheduler);
    if (next === undefined) return;
    if (sameHandle(next.handle, state.playerId)) return;
    pop(state.scheduler);
    if (!isLiveHandle(state.world, next.handle)) continue;
    const acted = runAi(state, rng, next.handle);
    if (acted) schedule(state.scheduler, ACTION_COST, next.handle);
  }
}
