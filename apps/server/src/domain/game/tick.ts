import { getTile, inBounds, TILE_WALL } from "../dungeon/index";
import {
  type EntityHandle,
  getComponent,
  isLiveHandle,
  setComponent,
} from "../ecs/index";
import { peek, pop, schedule } from "../scheduler/index";
import type { GameState } from "./state";

export type Dir = "n" | "e" | "s" | "w";
export type Action =
  | { readonly type: "MOVE"; readonly dir: Dir }
  | { readonly type: "WAIT" };

/**
 * Cost of a basic action in scheduler ticks. 1 "turn" = 100 ticks; speed
 * variants land naturally as smaller (fast) or larger (slow) costs once
 * AI lands in phase 2.
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
  // Invariant: when an inbound action arrives, the scheduler head is the
  // player. Phase 2 will drain AI events before returning so this is true
  // at the entry of the next tick.
  const top = peek(state.scheduler);
  if (top === undefined) {
    throw new Error(
      "tick: scheduler is empty (newGame must schedule the player)",
    );
  }
  if (!sameHandle(top.handle, state.playerId)) {
    throw new Error("tick: scheduler head is not the player");
  }

  if (action.type === "MOVE") {
    const pos = getComponent(state.world, state.playerId, "position");
    if (pos === undefined) {
      throw new Error("tick: player entity is missing the position component");
    }
    const [dx, dy] = dirDelta(action.dir);
    const nx = pos.x + dx;
    const ny = pos.y + dy;
    // Refused inputs do not consume the player's turn: keep the heap and
    // `turn` untouched, return the same wrapper so callers can fast-eq.
    if (!inBounds(nx, ny, state.level.grid)) return state;
    if (getTile(state.level.grid, nx, ny) === TILE_WALL) return state;
    pop(state.scheduler);
    setComponent(state.world, state.playerId, "position", { x: nx, y: ny });
    schedule(state.scheduler, ACTION_COST, state.playerId);
    return { ...state, turn: state.turn + 1 };
  }

  // WAIT — no validation can refuse it; spend the turn.
  pop(state.scheduler);
  schedule(state.scheduler, ACTION_COST, state.playerId);
  return { ...state, turn: state.turn + 1 };
}
