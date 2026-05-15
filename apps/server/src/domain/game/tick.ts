/**
 * The tick reducer. One player action in, one new `GameState` out, every
 * non-player event up to the next player turn drained in between.
 *
 * Companion modules:
 *  - `./ai.ts` — in-bubble AI dispatch (`runAi`).
 *  - `./abstract.ts` — out-of-bubble NPC resolver (`applyAbstract`).
 *  - `./state.ts` — runtime accessors (`activeWorld`, `activeLevel`,
 *    `entityAt`, `getZone`).
 *
 * The detailed story (mutation model, drain semantics, refused-action
 * contract) lives in `docs/GAME-LOOP.md`; the multi-zone backbone in
 * `docs/LIVING-WORLD.md`.
 */

import { getTile, inBounds, TILE_WALL } from "../dungeon/index";
import {
  despawn,
  getComponent,
  isLiveHandle,
  sameHandle,
  setComponent,
} from "../ecs/index";
import { fromRngState, type Rng } from "../rng/index";
import { peek, pop, type ScheduledEvent, schedule } from "../scheduler/index";
import { applyAbstract } from "./abstract";
import { runAi } from "./ai";
import { attack } from "./combat";
import { activeLevel, activeWorld, entityAt, getZone } from "./state";
import { enterZone } from "./transition";
import type { Action, Dir, GameState, GlobalEvent } from "./types";

/**
 * Base cost of a basic action in scheduler ticks. 1 "turn" = 100 ticks; speed
 * variants land naturally as smaller (fast) or larger (slow) costs in later
 * phases.
 */
const ACTION_COST = 100;

function dirDelta(dir: Dir): readonly [number, number] {
  switch (dir) {
    case "n":
      return [0, -1];
    case "e":
      return [1, 0];
    case "s":
      return [0, 1];
    case "w":
      return [-1, 0];
    default: {
      const _exhaustive: never = dir;
      throw new Error(`dirDelta: unhandled direction ${String(_exhaustive)}`);
    }
  }
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
 * `ACTION_COST` later. Called by every accepted player action — MOVE
 * (bump or step) and WAIT today. Centralises the pop+schedule pair so a
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
  if (state.gameOver) {
    throw new Error("tick: the run is over (player died); no further actions");
  }
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

  // ENTER_ZONE is the only action that rotates `activeZone` and `playerId`;
  // every other path keeps the same wrapper fields and just mutates the
  // shared heap / world. `working` therefore starts as `state` and only
  // diverges in the ENTER_ZONE arm.
  let working: GameState = state;

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
      // Bump-combat: stepping into an occupied tile resolves as an attack
      // against the occupant instead of a refusal. Killed targets are
      // despawned; their pending heap entry will be lazy-skipped on pop.
      const target = entityAt(world, nx, ny);
      if (target !== undefined) {
        const result = attack(world, rng, target);
        if (result.killed) despawn(world, target);
      } else {
        setComponent(world, state.playerId, "position", { x: nx, y: ny });
      }
      consumeTurn(state);
      break;
    }
    case "WAIT": {
      consumeTurn(state);
      break;
    }
    case "ENTER_ZONE": {
      const next = enterZone(state, action.zone, ACTION_COST);
      // Same-zone target = silent refusal (mirrors the MOVE-into-wall
      // contract: same wrapper, no turn cost, no RNG advance).
      if (next === state) return state;
      working = next;
      break;
    }
    default: {
      const _exhaustive: never = action;
      throw new Error(`tick: unhandled action ${JSON.stringify(_exhaustive)}`);
    }
  }

  drainNonPlayer(working, rng);

  return {
    ...working,
    rngState: rng.state(),
    time: working.globalScheduler.now,
    turn: working.turn + 1,
    gameOver: playerIsDead(working),
  };
}

/**
 * Player death detection. Returns `true` iff the player's hp has hit zero.
 * The player entity is never despawned — keeping it in the world lets the
 * snapshot still report its last position next to the `gameOver` banner.
 */
function playerIsDead(state: GameState): boolean {
  const hp = getComponent(activeWorld(state), state.playerId, "hp");
  if (hp === undefined) return true;
  return hp.current <= 0;
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
    // The drain finishes its timestamp regardless of the player's HP —
    // every event the heap promised at the current `time` runs, in
    // `(time, seq)` order. `attack` on a dead player is a clamped no-op,
    // not a corruption. `gameOver` is computed once at the end of `tick`
    // from the player's final HP.
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
        // skip already-applied events on concretisation.
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
