# `domain/game`

Turn-based game loop. Pure-ish reducer `(state, action) → state` over one or more ECS worlds (one per zone), single `(time, seq)` global heap, single sfc32 RNG stream — the substrate that makes save/replay byte-deterministic across runs.

> Deep dives:
> - `docs/GAME-LOOP.md` — Phase 1-2 mental model: scheduler, tick reducer, drain loop, refused-action contract, RNG threading.
> - `docs/LIVING-WORLD.md` — Phase 3+ multi-zone architecture: `Map<ZoneId, ZoneStatus>`, active/dormant discriminator, abstract resolvers, zone transitions.
>
> Read those before grepping or proposing a new pattern.

## Module map

```
game/
  index.ts        public barrel — the contract; exported names are stable
  types.ts        ZoneId / Time / ZoneStatus / GlobalEvent / GameState / Action / Dir
  brands.ts       branded ids (the one sanctioned `as`)
  state.ts        getZone / activeZoneStatus / activeWorld / activeLevel / entityAt
  perception.ts   updatePerception (FOV → ZoneStatus.seen/visible glue)
  tick.ts         tick reducer + drainNonPlayer (dispatch on GlobalEvent.kind)
  tests/          tick + perception (root orchestrator + cross-cutting glue)
  creatures/      one game system: combat + AI
    index.ts      sub-barrel: runAi, attack, AttackResult
    ai.ts         runAi dispatcher (in-bubble) + per-kind handlers
    combat.ts     attack (Phase 5 bump-combat, pure-on-world leaf)
    tests/        combat + wanderer
  zones/          one game system: world setup + zone lifecycle
    index.ts      sub-barrel: newGame, applyAbstract, concretize, enterZone, parkActiveZone
    newGame.ts    newGame + spawnDonjonZone + spawnVillageZone
    abstract.ts   applyAbstract (off-zone NPC schedules)
    transition.ts parkActiveZone + concretize + enterZone (Phase 6 zone transitions)
    tests/        transition + village
```

**Convention:** one game system = one folder under `game/` (`creatures/`,
`zones/`, …), each with its own `index.ts` sub-barrel and `tests/`. `tick` stays
a thin orchestrator that wires the systems together; the root holds shared
*vocabulary* (`types`, `brands`) and shared *services* (`state`, `perception`).
New systems (the creature FSM, nommage, métiers) land as their own folder — they
do not get added flat at the root. Internal files import from each other
directly; external callers (WS handler, tests, client-shared types via Eden)
import from `./index`.

## Public API

```ts
import {
  newGame,              // (seed, style) → GameState
  tick,                 // (state, action) → GameState
  attack,               // (world, rng, target) → AttackResult
  entityAt,             // (world, x, y) → EntityHandle | undefined
  runAi,                // (state, rng, handle) → boolean
  applyAbstract,        // (zone & {kind:"dormant"}, entity) → number | undefined
  parkActiveZone,       // (state, id) → void
  concretize,           // (state, id) → void
  enterZone,            // (state, target, actionCost) → GameState
  getZone,              // (state, id) → ZoneStatus
  activeZoneStatus,     // (state) → ZoneStatus & { kind: "active" }
  activeWorld,          // (state) → World
  activeLevel,          // (state) → Level
  type Action,
  type Dir,
  type GameState,
  type GlobalEvent,
  type Time,
  type ZoneId,
  type ZoneStatus,
  type AttackResult,
} from "./domain/game";
```

## Architecture invariants (do NOT violate)

- **Server is the only source of truth.** Movement validation, RNG, combat, loot, level generation, line-of-sight: server only. Never in `apps/client`.
- **Turn-based loop.** One player action → one server tick → one state push over WS. No client-side prediction, no rollback.
- **One global RNG stream** (`GameState.rngState`). Every roll across every zone consumes the same sfc32 sequence. Total `(time, seq)` ordering ⇒ deterministic replay across zones.
- **Mutation model.** The `GameState` literal rotates per tick (new `rngState`, `time`, `turn`); the inner refs (`zones`, each zone's `World`, `globalScheduler.heap`) are mutated in place. Pure-reducer ergonomics on the outside, ECS perf on the inside.
- **Refused-action contract.** If `tick` rejects an action (MOVE into a wall / unknown ENTER_ZONE target / same-zone ENTER_ZONE), it returns the same `state` reference. No heap mutation, no `rngState` advance, no `turn` increment. The WS layer can `===`-compare and skip the broadcast.
- **Discriminated unions exhaustive.** Every `switch` on `Action.type`, `GlobalEvent.kind`, `Ai.kind`, `ZoneStatus.kind` has a `default` arm with a `never` sentinel — adding a variant without its dispatch is a compile error.
- **Validate at boundaries.** Inbound WS messages are validated by TypeBox; internal state corruption (unknown zone id from a save, missing player position, `gameOver` action after death) throws loud rather than degrading silently.

## Heap dispatch (`drainNonPlayer`)

The drain loop in `tick.ts` pops every event between the just-consumed player turn and the next one, dispatching by `GlobalEvent.kind`:

- `actor` ⇒ `runAi(state, rng, ev.entity)` (in-bubble AI). Must reference the active zone — `actor` events for a dormant zone are a state-machine bug.
- `schedule` ⇒ `applyAbstract(zone, ev.entity)` (off-zone NPC waypoint advance). Must reference a dormant zone — `schedule` events for an active zone are a state-machine bug.

The `never` sentinel in the `default` arm forces any new `GlobalEvent` variant to land alongside its dispatcher at compile time.

## Zone transitions (Phase 6)

`Action.ENTER_ZONE { zone }` rotates `state.activeZone` and `state.playerId`. `enterZone` orchestrates:

1. Validate (refuse silently on same-zone or unknown-zone target).
2. Pre-compute the player's spawn cell in the target — *before* any mutation, so a level-degeneracy throw can't poison the WS session.
3. Pop the player's current actor event; capture `playerNextTime = scheduler.now + actionCost`.
4. `parkActiveZone(current)` — despawn player, drop actor events for the zone, re-add schedule events for entities with a `Schedule` component, flip to dormant.
5. `concretize(target)` — catchup due schedule events, drop the rest, flip to active, re-schedule actor events for entities with an `Ai` component.
6. Spawn the player in the new world with carried hp.
7. `scheduleAt(scheduler, playerNextTime, …)` — immune to catchup-induced `scheduler.now` advance.
8. Return a rotated wrapper `{ ...state, activeZone: target, playerId: newId }`.

Heap invariants after a transition: no `actor` event references a dormant zone, no `schedule` event references an active zone. `drainNonPlayer` enforces them at runtime by throwing on a violation.

## Tests

`bun test src/domain/game` (~76 tests today) covers tick / wanderer / village / combat / transition. Determinism is asserted by replaying `(seed, action sequence)` and comparing trajectories.

## Don't reach for these — explicit rejections

| Pattern | Why not |
|---|---|
| **Game logic on the client** | Violates the server-authoritative invariant. The client is a renderer + input forwarder, nothing else. |
| **Client-side prediction / rollback** | Turn-based loop, no jitter to hide, no latency budget to recover. Adds bugs for zero gain. |
| **Per-actor / per-zone RNG stream** | Bookkeeping for no benefit; single stream + `(time, seq)` order gives replay determinism. |
| **`Math.random()` anywhere in `domain/`** | Banned. Every roll goes through `state.rngState` via `fromRngState`. |
| **Database / ORM / persistence layer** | State lives in server memory until explicitly asked. Snapshot/restore via the ECS module's `snapshot` / `restore` (round-trip byte-equal). |
| **Energy/speed accumulator** | `O(actors)` per tick. Loses to the heap on sparse wakeups (shopkeeper at dawn, patrol at T+5h). |
| **CDDA-style "freeze + catchup on entry"** | The reality-bubble bug class CDDA acknowledged with `queue_eocs` (2024) and overmap-NPC simulation. The Qud trick (abstract resolvers + global heap) avoids it by construction. |
| **Marker-component-per-AI-kind dispatch** | Wins only with archetype-cache-blocked iteration. Our column-store + ≤100 actors per zone makes the `switch(ai.kind)` + `never` sentinel the right call. |

Full rationale and 2026-05 audit: `docs/LIVING-WORLD.md` § "Why this and not the alternatives".
