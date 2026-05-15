# Living world — multi-zone architecture

Korr Aelvein's setting demands a world that **keeps living**: every dungeon
floor and the village around the rim continue to evolve while the player is
elsewhere. The shopkeeper opens at dawn whether or not the player is in the
village; deeper-floor patrols keep their routes; events fire on the global
timeline, not just on the player's current floor.

This doc is the architectural commitment. **Not yet implemented** — the
current code (Phases 1-2, see `docs/GAME-LOOP.md`) is the single-zone case
of this design. Everything below preserves every invariant
`docs/GAME-LOOP.md` documents and extends them across zones.

## The pattern: reality bubble + scheduled events on a global heap

**Caves of Qud-style.** One `World` per zone. One zone "active" at a time
(fine-grain tick, AI at action granularity). Other zones are "dormant" —
they keep their `World` (tiles, items, NPC state) but their actors don't
tick continuously. Instead, NPCs deposit **scheduled events** on a
**global** min-heap: "Smith opens shop at game-time T", "Patrol arrives at
point P at T + 5h", "Sun rises at T = dawn".

Zone entry is a catchup: drain every off-zone event due since `lastSimAt`
through pure **abstract resolvers** that mutate the dormant zone's `World`
columns. No fine-grain pathfinding, no per-tick simulation in absentia —
only the discrete state changes the player would notice.

### Why this and not the alternatives

- **Full simulation everywhere** (Dwarf Fortress, ToME). Every dormant
  zone ticks every player action. Wastes ~95 % of CPU on invisible state;
  blows up replay length. DF pays this because the sim *is* the game. We
  don't.
- **CDDA-style "freeze + catchup on entry".** Dormant state is frozen,
  off-zone NPCs don't act. CDDA acknowledged the limit by retrofitting
  `queue_eocs` (2024) and overmap-NPC simulation (PR #35124) — exactly
  the friction we avoid by starting on the right pattern.
- **Multi-scale layers** (DF fortress-mode vs world-mode). Demands writing
  each behaviour twice at two grains (fine + coarse). Earned only when
  emergent faction-level dynamics arrive. Premature today.

(2026-05 audit; sources at bottom.)

## Target `GameState` shape

```ts
type ZoneId = number; // plain number — no brand. The project forbids `as`,
                      // and constructing a branded type without it requires
                      // a class wrapper. Plain number is enough; ZoneId is
                      // documentation, not type-system enforcement.
type Time = number;   // game-ticks since epoch, monotonic.

// Phase 3 ships a single shape (no discriminator). Phase 4 will introduce
// the discriminator and a `dormant` variant when the dormant shape is
// decided from real evidence (likely `summary: ActorSummary[]` rather than
// a full `World`).
type ZoneStatus = { world: World; level: Level };

// Phase 4 target (illustrative, not committed):
// type ZoneStatus =
//   | { kind: "active";  world: World; level: Level }
//   | { kind: "dormant"; level: Level; summary: ActorSummary[]; lastSimAt: Time };

type GameState = {
  readonly zones: Map<ZoneId, ZoneStatus>;
  readonly activeZone: ZoneId;
  readonly playerId: EntityHandle;
  readonly globalScheduler: Scheduler<GlobalEvent>;
  readonly rngState: RngState;
  readonly time: Time;
  readonly turn: number;
};

type GlobalEvent =
  | { kind: "actor";    zone: ZoneId; entity: EntityHandle }
  | { kind: "schedule"; zone: ZoneId; entity: EntityHandle }
  // Future arm — lands when a use case appears:
  // | { kind: "world"; effect: WorldEffectId }
  ;
```

**Phase 3 shipped** the multi-zone skeleton with a single-shape `ZoneStatus`
(no discriminator) and a single `GlobalEvent.actor` variant. **Phase 4
shipped** the `active` / `dormant` discriminator, the `GlobalEvent.schedule`
variant, the abstract resolver pipeline (`game/abstract.ts`), and a first
dormant village zone with a shopkeeper NPC oscillating between home and
counter on a fixed period. **Phase 6 shipped** the zone-transition primitives
(`parkActiveZone` / `concretize` / `enterZone`) and the `Action.ENTER_ZONE`
inbound action that ties them to the tick reducer.

### The NPC `Schedule` component

```ts
type Schedule = {
  readonly waypoints: ReadonlyArray<readonly [number, number]>;
  readonly nextIndex: number; // next waypoint to apply, in [0, waypoints.length)
  readonly period: number;    // game-ticks between consecutive transitions
};
```

Lives on the NPC entity itself (plumbed through `ecs/components.ts` + the
column dispatch tables in `ecs/world.ts`). Carries the persistent state
that survives despawn/respawn and JSON snapshot/restore; the global heap
carries only the trigger (`GlobalEvent.schedule { zone, entity }`).

Boundary validation in `cloneAndValidateSchedule` rejects empty waypoints,
non-positive periods, out-of-range `current`, non-finite coordinates —
same boundary defence as `cloneAi` rejects unknown ai kinds.

### Abstract resolver (`game/abstract.ts`)

```ts
applyAbstract(zone: ZoneStatus & { kind: "dormant" }, entity: EntityHandle):
  number | undefined
```

Takes the already-narrowed dormant zone and the entity handle. Mutates the
zone's `position` column to `waypoints[nextIndex]`, advances `nextIndex`
modulo `waypoints.length`. Returns the schedule's `period` (so the caller
can reschedule the next event without a second `getComponent` lookup),
or `undefined` if the entity is stale or has lost its `Schedule`.

The drain loop owns rescheduling — `applyAbstract` is pure-on-zone and
trivially testable in isolation.

### What survives Phases 1-2 intact

- **The `(time, seq)` min-heap.** Becomes the world timeline instead of a
  single zone's timeline. Same data structure, same complexity, same lazy
  stale-skip policy.
- **Single `RngState`.** One sfc32 stream. Total ordering by `(time, seq)`
  guarantees deterministic replay across zones. No per-zone or per-NPC
  RNG split.
- **`World` per zone.** Same column-store, just N of them in a `Map`.
- **`runAi`, `entityAt`, drain loop.** Unchanged for the active zone.
- **The reducer signature `(state, action) → state`.** Unchanged.

### What's new

1. **Abstract resolvers** — pure functions
   `applyAbstract(state, evt): void` that mutate a dormant zone's `World`
   for one event class: "shopkeeper at counter", "door state = open",
   "corpse count += 1". No pathfinding, no per-tick AI.

   **Authoring rule: write the abstract form first.** The concrete
   (in-bubble) AI is a "play it out" specialization. That's the Qud trick
   — it keeps the duplication tractable. Without this discipline, the
   pattern degenerates into either CDDA's missing-offstage-AI bug class or
   into full simulation in disguise.

2. **`parkActiveZone` / `concretize` / `enterZone`** — transitions between
   active and dormant. Live in `apps/server/src/domain/game/transition.ts`.
   See the "Zone transitions (Phase 6)" section below for the actual shape.

3. **Global `time`.** `state.time` is the monotonic clock all events
   reference. `scheduler.now` becomes a local heap detail.

### Zone transitions (Phase 6)

`game/transition.ts` exports three primitives:

```ts
parkActiveZone(state: GameState, id: ZoneId): void
concretize(state: GameState, id: ZoneId): void
enterZone(state: GameState, target: ZoneId, actionCost: number): GameState
```

The orchestrator is `enterZone`; `parkActiveZone` and `concretize` are
exported so each lifecycle half can be tested in isolation.

**`parkActiveZone(state, id)`** — `id` must currently be `active`:

1. Despawn the player from the parked world (caller has already read any
   persistent components like `hp` it needs to carry across).
2. Drop every `actor` event for `id` from the global heap (player's and
   in-bubble NPCs').
3. For every entity in `id`'s world that carries a `Schedule`, push a
   fresh `schedule` event at `state.time + period`. This is what lets the
   shopkeeper resume cycling once the village goes dormant again.
4. Flip the status to `{ kind: "dormant", world, level, lastSimAt: state.time }`.

Active-zone NPCs without a `Schedule` (today: wanderers) **freeze** — no
events, world state preserved. NPCs with a `Schedule` resume on a fresh
`period`-tick clock; partial-period carry-over from the in-bubble phase is
not tracked.

**`concretize(state, id)`** — `id` must currently be `dormant`:

1. Catchup: pop every `schedule` event for `id` with `time <= state.time`
   in `(time, seq)` order, apply each via `applyAbstract`, advance
   `lastSimAt` to the highest applied time.
2. Drop remaining `schedule` events for `id` from the heap (they would
   throw in `drainNonPlayer` once the zone is active).
3. Flip the status to `{ kind: "active", world, level }`.
4. For every entity in `id`'s world with an `Ai` component, push an
   `actor` event at `state.time` (resume in-bubble ticking).

Catchup is mostly defensive in the current architecture: `drainNonPlayer`
processes dormant `schedule` events continuously, so `lastSimAt` for the
soon-to-be-active zone is typically already `state.time`. Pinning the
contract keeps the design safe under future drain refactors.

NPCs with only a `Schedule` (today: shopkeeper) become **inert** when their
zone is active — schedule events dropped, no actor events added, world
state preserved.

**`enterZone(state, target, actionCost)`** — full transition:

1. Refuse silently (return the same `state` reference) when `target ===
   state.activeZone`.
2. Throw when `target` is unknown or not dormant.
3. Read `hp` off the player in the old world (the only persistent player
   component carried today).
4. Record `playerNextTime = scheduler.now + actionCost` *before* any heap
   mutation — catchup advances `scheduler.now`, so a relative `delay`
   computed afterwards would shift the player's next slot.
5. `pop` the player's current actor event off the heap.
6. `parkActiveZone(state, state.activeZone)`.
7. `concretize(state, target)`.
8. `spawn` the player in the target world at `level.spawn` (or the first
   free floor cell if a frozen NPC happens to be standing on it), with the
   carried `hp`.
9. `scheduleAt(scheduler, playerNextTime, …)` — the player's actor event
   at the original turn-cost target, immune to catchup-induced
   `scheduler.now` advance.
10. Rotate the wrapper: `{ ...state, activeZone: target, playerId: newId }`.

The drain in `tick` then runs on the rotated wrapper and re-establishes the
"player on heap top" invariant before returning.

### Heap invariants after a transition

- No `actor` event references a dormant zone.
- No `schedule` event references an active zone.
- The player's actor event sits at `time = previousTime + ACTION_COST`
  regardless of how many catchup events fired in between.

The first two are pinned by `parkActiveZone` and `concretize` respectively;
`drainNonPlayer` enforces them at runtime by throwing on a violation.

## Phasing

| Phase | Scope | Status |
|---|---|---|
| 1 | Min-heap scheduler + `WAIT` action | done (PR #7) |
| 2 | Wanderer mob + drain loop + first AI | done (PR #8) |
| 3 | Multi-zone `GameState` shape, **single zone for now** (the donjon) — no village, no abstract events yet | done (PR #10) |
| 4 | First scheduled NPC abstract (shopkeeper home / counter oscillation) + `active` / `dormant` discriminator + abstract-resolver pipeline validated end-to-end | done |
| 5 | Bump-combat (`MOVE` into actor → `ATTACK`, hp damage via `rng.int`, despawn on hp ≤ 0, `gameOver` in snapshot) | done |
| 6 | Zone transition: player travels donjon ↔ village. `parkActiveZone` / `concretize` / `enterZone` orchestrator + `Action.ENTER_ZONE` wired through tick. | done |
| later | More NPC variants, weather / world events, time-of-day, multi-floor descent | planned |

**Phase 3 is structural-only.** Get the shape (`zones: Map`,
`globalScheduler`, `time`) right so Phase 4 only adds branches to
`GlobalEvent`. No new gameplay in Phase 3, no abstract resolvers yet — a
single `actor`-kind event class suffices.

## Determinism contract under multi-zone

- One `RngState` per `GameState`. Every roll across every zone consumes
  the same stream.
- `(time, seq)` totally orders events globally. Replay of the same
  `(seed, action sequence)` produces byte-identical `GameState` sequences.
- Abstract resolvers are pure: same `(state, evt)` always produces the
  same mutation.
- `lastSimAt` per dormant zone is bookkeeping only — it bounds the
  catchup search, doesn't change outcomes.

## Trade-offs accepted

- **Logic-in-double (abstract + concrete).** The cost of the Qud trick.
  Mitigated by writing the abstract form first; concrete is the
  specialization. The failure mode without it is CDDA's reality-bubble
  bug class.
- **Global heap carries cross-zone handles.** Zero issue with our lazy
  stale-skip from Phase 1.
- **Single RNG stream couples all zones.** Fine for solo + serial tick.
  Revisit only on parallelization (not planned).

## Sources (2026-05 audit)

- **Caves of Qud Wiki — Modding: Turns, Segments, and Actions.**
  `XRL.Core.ActionManager` is a single global action queue with
  quickness/segments. Validates "one global scheduler" at production
  scale. <https://wiki.cavesofqud.com/wiki/Modding:Turns,_Segments,_and_Actions>
- **Cataclysm-DDA FAQ from Discord** (active 2024-2025). "The CDDA game
  engine only loads and simulates the overmap terrain tile that your
  avatar is currently at." Pure reality-bubble — confirms pattern 3's
  limit. <https://github.com/CleverRaven/Cataclysm-DDA/wiki/FAQ-from-Discord>
- **CDDA PR #35124 — Dynamic NPCs find a base and travel there.** "NPCs
  travel on the overmap outside of reality bubble now — not loaded and
  active, but simulated on the overmapbuffer." Documented retrofit on top
  of pattern 3 — the friction we avoid.
  <https://github.com/CleverRaven/Cataclysm-DDA/pull/35124>
- **CDDA Discourse — Timers and the Reality Bubble.** The class of bugs
  where timers stop progressing outside the bubble; `queue_eocs` rewrite
  (2024) replaces the old timer system. Concrete evidence of the gotcha
  pattern 3 incurs. <https://discourse.cataclysmdda.org/t/timers-and-the-reality-bubble-adventures-with-c4/3785>
- **CDDA docs — Effect On Condition** (2025). "NPC-run EoCs can work
  outside of reality bubble, while monsters-run EoCs only work inside";
  `RECURRING` cadence types. The production-proven shape of "schedule
  events on a global heap". <https://docs.cataclysmdda.org/JSON/EFFECT_ON_CONDITION.html>
- **Ultima Ratio Regum 0.11 update #7** (Mark R. Johnson, 2023). "NPCs
  move around on schedules… several dozen NPC types each with their own
  schedules which play out alongside the player's actions." 2023 indie
  roguelike confirming pattern 2 for a town/world feel.
  <https://www.markrjohnsongames.com/2023/08/07/ultima-ratio-regum-0-11-update-7/>
- **Dwarf Fortress Wiki — World activities.** Off-site sites are
  conquered, looted, etc. while you play; the engine that earns full
  sim. Justifies *not* picking pattern 1 unless you're DF.
  <https://dwarffortresswiki.org/index.php/World_activities>
- **Bevy Discussion #20238** (2025). "Full multiworld support… will take
  a while, probably years"; subworlds/SubApps "pretty clunky". Justifies
  one custom `Map<ZoneId, World>` over ECS-engine subworld features.
  <https://github.com/bevyengine/bevy/discussions/20238>
- **RogueBasin — A priority queue based turn scheduling system.**
  Canonical write-up; still endorsed in 2024 gridbugs devlogs and
  r/roguelikedev FAQ Friday threads. Confirms our existing min-heap is
  the right substrate; pattern 2 extends it instead of replacing it.
  <https://www.roguebasin.com/index.php?title=A_priority_queue_based_turn_scheduling_system>
- **Game AI Pro 2, Chapter 41 — Simulation Principles from Dwarf
  Fortress** (Tarn Adams). Abstract-vs-concrete actor representation is
  the only way to scale; the architectural primitive pattern 2 depends
  on. <http://www.gameaipro.com/GameAIPro2/GameAIPro2_Chapter41_Simulation_Principles_from_Dwarf_Fortress.pdf>
