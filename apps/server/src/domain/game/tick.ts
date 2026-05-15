import { getTile, inBounds, TILE_WALL } from "../dungeon/index";
import {
  type EntityHandle,
  getComponent,
  isLiveHandle,
  setComponent,
} from "../ecs/index";
import { fromRngState, type Rng } from "../rng/index";
import { peek, pop, type ScheduledEvent, schedule } from "../scheduler/index";
import { runAi } from "./ai";
import {
  activeLevel,
  activeWorld,
  cellBlocked,
  type GameState,
  type GlobalEvent,
} from "./state";

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

/**
 * True when `ev` is the player's own actor turn in the currently active
 * zone. The drain loop stops on this so the next inbound action dispatches
 * from "player on top".
 */
function isPlayerTurn(
  ev: ScheduledEvent<GlobalEvent>,
  state: GameState,
): boolean {
  const p = ev.payload;
  return (
    p.kind === "actor" &&
    p.zone === state.activeZone &&
    sameHandle(p.actor, state.playerId)
  );
}

export function tick(state: GameState, action: Action): GameState {
  const world = activeWorld(state);
  const level = activeLevel(state);
  if (!isLiveHandle(world, state.playerId)) {
    throw new Error("tick: player handle is stale (entity despawned)");
  }
  // Invariant: every inbound action arrives when the scheduler head is the
  // player. The drain loop at the bottom of every accepted tick re-establishes
  // it before returning, so the invariant survives across calls.
  const top = peek(state.globalScheduler);
  if (top === undefined) {
    throw new Error(
      "tick: scheduler is empty (newGame must schedule the player)",
    );
  }
  if (!isPlayerTurn(top, state)) {
    throw new Error("tick: scheduler head is not the player");
  }

  // Hydrate RNG once per accepted action. Returned `rng.state()` is persisted
  // back into the new GameState even when no rolls happened (cheap, and
  // guarantees a single source of truth for replay determinism).
  const rng = fromRngState(state.rngState);

  if (action.type === "MOVE") {
    const pos = getComponent(world, state.playerId, "position");
    if (pos === undefined) {
      throw new Error("tick: player entity is missing the position component");
    }
    const [dx, dy] = dirDelta(action.dir);
    const nx = pos.x + dx;
    const ny = pos.y + dy;
    // Refused inputs do not consume the player's turn: keep heap, world,
    // time, and turn untouched; return the same wrapper for fast-eq.
    if (!inBounds(nx, ny, level.grid)) return state;
    if (getTile(level.grid, nx, ny) === TILE_WALL) return state;
    // Phase 5 (bump-combat) will replace this branch with an ATTACK action.
    if (cellBlocked(world, nx, ny)) return state;
    pop(state.globalScheduler);
    setComponent(world, state.playerId, "position", { x: nx, y: ny });
    schedule(state.globalScheduler, ACTION_COST, {
      kind: "actor",
      zone: state.activeZone,
      actor: state.playerId,
    });
  } else {
    // WAIT — no validation can refuse it; spend the turn.
    pop(state.globalScheduler);
    schedule(state.globalScheduler, ACTION_COST, {
      kind: "actor",
      zone: state.activeZone,
      actor: state.playerId,
    });
  }

  drainNonPlayer(state, rng);

  return {
    ...state,
    rngState: rng.state(),
    time: state.globalScheduler.now,
    turn: state.turn + 1,
  };
}

/**
 * Pop every non-player event up to (but not including) the player's next
 * turn. Stale entries are skipped lazily — they advance `scheduler.now` to
 * their `time` (game-time invariant) but are not dispatched or rescheduled.
 * Entities whose `ai` component has been stripped (despawn race, future
 * status effects) drop out of the heap rather than zombie-cycle forever.
 *
 * Phase 3: only the `actor` event variant exists, and only for the active
 * zone (no dormant zones yet). The `default` branch's `never` sentinel
 * forces Phase 4 to grow the dispatch alongside any new `GlobalEvent` kind.
 */
function drainNonPlayer(state: GameState, rng: Rng): void {
  while (true) {
    const next = peek(state.globalScheduler);
    if (next === undefined) return;
    if (isPlayerTurn(next, state)) return;
    pop(state.globalScheduler);
    const ev = next.payload;
    switch (ev.kind) {
      case "actor": {
        if (ev.zone !== state.activeZone) {
          // Phase 4 turns this branch into the abstract-resolver dispatch —
          // do not change it to `continue` without implementing the resolver,
          // or the event will be silently dropped.
          throw new Error(
            `drainNonPlayer: actor event for non-active zone ${ev.zone}`,
          );
        }
        const world = activeWorld(state);
        if (!isLiveHandle(world, ev.actor)) continue;
        const acted = runAi(state, rng, ev.actor);
        if (acted) {
          schedule(state.globalScheduler, ACTION_COST, {
            kind: "actor",
            zone: ev.zone,
            actor: ev.actor,
          });
        }
        break;
      }
      default: {
        const _exhaustive: never = ev.kind;
        throw new Error(
          `drainNonPlayer: unhandled event kind ${String(_exhaustive)}`,
        );
      }
    }
  }
}
