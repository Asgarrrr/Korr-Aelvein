import { getTile, inBounds, TILE_WALL } from "../dungeon/index";
import {
  type EntityHandle,
  getComponent,
  isLiveHandle,
  setComponent,
} from "../ecs/index";
import { fromRngState, type Rng } from "../rng/index";
import { peek, pop, type ScheduledEvent, schedule } from "../scheduler/index";
import { applyAbstract } from "./abstract";
import { runAi } from "./ai";
import {
  activeLevel,
  activeWorld,
  entityAt,
  type GameState,
  type GlobalEvent,
  getZone,
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
    sameHandle(p.entity, state.playerId)
  );
}

/**
 * Pop the player's current heap entry and reschedule a fresh one
 * `ACTION_COST` later. Called by every accepted player action — MOVE and
 * WAIT today, ATTACK in Phase 5. Centralises the pop+schedule pair so a
 * new action kind only has to declare its validation and world mutation.
 */
function consumeTurn(state: GameState): void {
  pop(state.globalScheduler);
  schedule(state.globalScheduler, ACTION_COST, {
    kind: "actor",
    zone: state.activeZone,
    entity: state.playerId,
  });
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

  switch (action.type) {
    case "MOVE": {
      const pos = getComponent(world, state.playerId, "position");
      if (pos === undefined) {
        throw new Error(
          "tick: player entity is missing the position component",
        );
      }
      const [dx, dy] = dirDelta(action.dir);
      const nx = pos.x + dx;
      const ny = pos.y + dy;
      // Refused inputs do not consume the player's turn: keep heap, world,
      // time, and turn untouched; return the same wrapper for fast-eq.
      if (!inBounds(nx, ny, level.grid)) return state;
      if (getTile(level.grid, nx, ny) === TILE_WALL) return state;
      // Phase 5 (bump-combat) will turn this branch into an ATTACK against
      // the returned handle instead of refusing the move.
      if (entityAt(world, nx, ny) !== undefined) return state;
      setComponent(world, state.playerId, "position", { x: nx, y: ny });
      consumeTurn(state);
      break;
    }
    case "WAIT": {
      consumeTurn(state);
      break;
    }
    default: {
      const _exhaustive: never = action;
      throw new Error(`tick: unhandled action ${JSON.stringify(_exhaustive)}`);
    }
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
 * Entities whose dispatch-relevant component has been stripped (`ai` for
 * active-zone actors, `schedule` for dormant NPCs) drop out of the heap
 * rather than zombie-cycle forever.
 *
 * Dispatch by event kind:
 *  - `actor`: fine-grain turn for an active-zone NPC. Run `runAi`. If the
 *    entity is still alive and acted, reschedule one `ACTION_COST` later.
 *    An `actor` event whose zone is not active is a state-machine bug —
 *    fail loud, as active-zone NPCs must be on the heap only while their
 *    zone is active.
 *  - `schedule`: coarse-grain trigger for a dormant-zone NPC. Run the
 *    abstract resolver; if it applied, reschedule at the entity's current
 *    `schedule.period`. A `schedule` event whose zone is active means a
 *    zone transition mis-converted entries — fail loud there too.
 *
 * The `default` branch's `never` sentinel forces any new `GlobalEvent`
 * variant to add its dispatch here at compile time.
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
          throw new Error(
            `drainNonPlayer: actor event for non-active zone ${ev.zone}`,
          );
        }
        const world = activeWorld(state);
        if (!isLiveHandle(world, ev.entity)) continue;
        const acted = runAi(state, rng, ev.entity);
        if (acted) {
          schedule(state.globalScheduler, ACTION_COST, {
            kind: "actor",
            zone: ev.zone,
            entity: ev.entity,
          });
        }
        break;
      }
      case "schedule": {
        const zone = getZone(state, ev.zone);
        if (zone.kind !== "dormant") {
          throw new Error(
            `drainNonPlayer: schedule event for ${zone.kind} zone ${ev.zone}`,
          );
        }
        const period = applyAbstract(zone, ev.entity);
        if (period === undefined) continue;
        // Record that the dormant zone has just been simulated up to this
        // event's time. Phase 6 zone-entry catchup uses `lastSimAt` to
        // skip already-applied events on concretization.
        zone.lastSimAt = next.time;
        schedule(state.globalScheduler, period, {
          kind: "schedule",
          zone: ev.zone,
          entity: ev.entity,
        });
        break;
      }
      default: {
        const _exhaustive: never = ev;
        throw new Error(
          `drainNonPlayer: unhandled event ${JSON.stringify(_exhaustive)}`,
        );
      }
    }
  }
}
