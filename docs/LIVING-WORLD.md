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
  | { kind: "actor";    zone: ZoneId; actor: EntityHandle }
  // Phase 4+ variants — not yet implemented, listed so the discriminator's
  // exhaustiveness story is clear:
  // | { kind: "schedule"; zone: ZoneId; npc: EntityHandle; activity: ActivityId }
  // | { kind: "world";    effect: WorldEffectId }
  ;
```

**Phase 3 ships only the `actor` variant** of `GlobalEvent` and a single-
shape `ZoneStatus` (no `active` / `dormant` discriminator yet). Phase 4
adds both: a new `GlobalEvent` arm for off-zone NPC schedules, *and* the
`ZoneStatus` discriminator with a `dormant` shape derived from real abstract-
resolver evidence.

### What survives Phases 1-2 intact

- **The `(time, seq)` min-heap.** Becomes the world timeline instead of a
  single zone's timeline. Same data structure, same complexity, same lazy
  stale-skip policy.
- **Single `RngState`.** One sfc32 stream. Total ordering by `(time, seq)`
  guarantees deterministic replay across zones. No per-zone or per-NPC
  RNG split.
- **`World` per zone.** Same column-store, just N of them in a `Map`.
- **`runAi`, `cellBlocked`, drain loop.** Unchanged for the active zone.
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

2. **`parkActiveZone` / `concretize`** — transitions between active and
   dormant. Leaving a zone: convert each in-flight actor turn into a
   `schedule`-kind global event. Entering a zone: drain due events,
   re-hydrate per-actor turn entries on a fresh per-zone scheduler.

3. **Global `time`.** `state.time` is the monotonic clock all events
   reference. `scheduler.now` becomes a local heap detail.

### Zone-entry catchup (sketch)

```ts
function enterZone(s: GameState, next: ZoneId): GameState {
  parkActiveZone(s);
  while (peekDueFor(s.globalScheduler, next, s.time)) {
    const evt = pop(s.globalScheduler);
    applyAbstract(s, evt); // pure; persists rngState through s
  }
  concretize(s, next);
  return s;
}
```

The drain is `O(events due for next since lastSimAt)` — **not** `O(time ×
entities)`. Sparse-wakeup workload fits the heap exactly.

## Phasing

| Phase | Scope | Status |
|---|---|---|
| 1 | Min-heap scheduler + `WAIT` action | done (PR #7) |
| 2 | Wanderer mob + drain loop + first AI | done (PR #8) |
| 3 | Multi-zone `GameState` shape, **single zone for now** (the donjon) — no village, no abstract events yet | done |
| 4 | First scheduled NPC abstract (shopkeeper open/close) — validates the abstract-resolver pipeline end-to-end | planned |
| 5 | Bump-combat (`MOVE` into actor → `ATTACK`, hp damage via `rng.int`, despawn on hp ≤ 0, `gameOver` in snapshot) | planned, orthogonal to Phase 4 |
| later | Village zone, weather / world events, time-of-day, multi-floor descent | planned |

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
