/**
 * Game-domain types. Type definitions only, no runtime code — importable
 * anywhere without dragging in `World` / `Scheduler` / RNG values.
 *
 * Deep-dive: `docs/GAME-LOOP.md` (single-zone mental model) and
 * `docs/LIVING-WORLD.md` (multi-zone architecture). Docstrings here keep to
 * invariants that are not obvious from the type itself.
 */

import type { Level } from "../dungeon/index";
import type { EntityHandle, World } from "../ecs/index";
import type { RngState } from "../rng/index";
import type { Scheduler } from "../scheduler/index";

/** Integer key into `GameState.zones`. Plain `number` because constructing a branded type requires `as`, which is banned. */
export type ZoneId = number;

/** Monotonic game-time in scheduler ticks. */
export type Time = number;

/**
 * Per-zone state. `active` = the player's current zone (fine-grain AI);
 * `dormant` = every other zone (events flow through the abstract resolver).
 */
export type ZoneStatus =
  | {
      readonly kind: "active";
      readonly world: World;
      readonly level: Level;
      /**
       * Player perception memory, one byte per tile (row-major,
       * `level.grid.width × level.grid.height`). `seen` accumulates every
       * tile ever perceived in this zone (drives the client's map memory
       * and the snapshot's tile masking); `visible` is the current FOV,
       * overwritten by `updatePerception` whenever the player moves.
       * Both mutable by deliberate exception to the surrounding
       * `readonly` (same convention as `lastSimAt`) so map-value identity
       * stays stable across ticks. **Not JSON-safe** — a `Uint8Array`
       * stringifies to an index-keyed object; a future save API must
       * serialise explicitly, same caveat as `GameState.zones`.
       */
      seen: Uint8Array;
      visible: Uint8Array;
    }
  | {
      readonly kind: "dormant";
      readonly world: World;
      readonly level: Level;
      /** See the `active` variant. `visible` is stale while the zone is
       * dormant (nobody recomputes it) — harmless: the snapshot only reads
       * the active zone and `enterZone` recomputes on arrival. `seen` is
       * the part that must survive dormancy. */
      seen: Uint8Array;
      visible: Uint8Array;
      /**
       * Game-time of the last applied `GlobalEvent.schedule`. Mutable by
       * deliberate exception to the surrounding `readonly` so map-value
       * identity stays stable across ticks (same convention as
       * `World.nextId`).
       */
      lastSimAt: Time;
    };

/**
 * Events on the global `(time, seq)` heap. Every variant carries
 * `entity: EntityHandle` — uniform payload so Phase 6 zone-park can flip
 * `kind` without renaming fields per payload. Drain dispatch uses a `never`
 * sentinel so a new variant forces compile errors at every dispatch site.
 */
export type GlobalEvent =
  | {
      readonly kind: "actor";
      readonly zone: ZoneId;
      readonly entity: EntityHandle;
    }
  | {
      readonly kind: "schedule";
      readonly zone: ZoneId;
      readonly entity: EntityHandle;
    };

/**
 * Multi-zone game state. The literal rotates per tick (new `rngState`,
 * `time`, `turn`); `zones`, each zone's `World`, and `globalScheduler.heap`
 * are mutated in place.
 */
export type GameState = {
  /**
   * **Not JSON-safe** — a `Map` stringifies to `{}`. Future `snapshotGameState`
   * must use `Array.from(state.zones)` and reconstruct via `new Map(entries)`
   * on restore. Map shape kept so the inner mutation model matches `World`.
   */
  readonly zones: Map<ZoneId, ZoneStatus>;
  readonly activeZone: ZoneId;
  readonly playerId: EntityHandle;
  readonly globalScheduler: Scheduler<GlobalEvent>;
  readonly rngState: RngState;
  /**
   * Set to `globalScheduler.now` at end of tick — the time of the most
   * recently popped event, not the player's next slot.
   */
  readonly time: Time;
  readonly turn: number;
  /**
   * `true` once the player's HP has hit zero. `tick` refuses to process
   * actions in that state; the snapshot exposes the flag so the client can
   * render the end-of-run banner. A later phase may add `gameWon` for
   * cleared objectives; today the flag is binary "the run ended".
   */
  readonly gameOver: boolean;
};

/** Cardinal direction taken by `MOVE` actions. */
export type Dir = "n" | "e" | "s" | "w";

/**
 * Inbound action from the player. The reducer dispatches on `type` with a
 * `never` exhaustiveness sentinel.
 *
 * `ENTER_ZONE` is the Phase 6 cross-zone teleport — the only action that
 * rotates `state.activeZone` and `state.playerId`. Reachability is currently
 * unrestricted; later phases will gate it on the player standing on a
 * stair / portal tile.
 */
export type Action =
  | { readonly type: "MOVE"; readonly dir: Dir }
  | { readonly type: "WAIT" }
  | { readonly type: "ENTER_ZONE"; readonly zone: ZoneId };
