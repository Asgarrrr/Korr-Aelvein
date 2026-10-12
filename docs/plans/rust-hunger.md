# Design: the mechanic seam, the lifecycle, and hunger

The step after flora in the Rust rewrite (`rust-structure.md` §0): hunger,
the mechanic at which the core API freezes. Brainstormed with the user on
2026-10-12. Inputs: a map of the Rust engine at c6961e3, a summary of the TS
hunger, and two research reports (mechanic seams in ECS engines and
deterministic sims; entity references, death and need decay in roguelikes).
The TS engine is not a spec.

## Goal and acceptance criteria

The goal is not hunger alone. It is the surface through which every later
mechanic (temperament, explore, fire, fear, combat) reads and writes the
world. Today a mechanic cannot touch a component: the ctxs expose only the
grid, `step` and `depart`; the caller builds the schema; `requires` names
components by string.

User criteria:

1. Zero core edits: adding a mechanic is a new crate plus one registry line,
   once the API freezes after hunger.
2. Misuse fails at compile time where possible: writing another module's
   component, reading a component that does not exist.
3. A full decision with hunger costs at most ~200 ns per entity at P = 1,
   measured by the `core` bench (TS measured 366 ns).

The project rule stays: the game runs with any mechanic removed.

## User decisions

- Approach A, typed keys at build, over Bevy-style `Has<T>` trait bounds
  (same power, far more type machinery) and over module state outside the
  ECS (breaks the uniform `Traveller` row, save and hash).
- Hunger never kills. Predation waits for the `combat` crate, which
  proposes `attack`. Until then, carnivores eat `Remains` only. Hunger
  publishes no contract yet: see Deviations.
- Entity targets carry an `EntityId`, resolved by a per-floor index.
- Every death goes through `harm`, starvation included, and leaves
  `Remains`.

## 1. Building the modules

- A module with keys exposes an inherent `pub fn build(b: &mut Builder) -> Self`
  and keeps the keys it receives in its own struct. `Module` has no required
  `build`: a keyless module builds as it is, and `keyed(M::build)` or the
  registry passes the builder to one that has keys.
- `b.own::<T>(name) -> Own<T>`: a private component. The builder prefixes
  the name with `M::NAME`, so a module cannot take another's name. The
  string is persistent, like a `ModuleKey`: it never follows a rename.
- Contracts are types in `korr-contracts`:
  `trait Contract: Component { const NAME: &'static str; }`. The crate holds
  types and their codec, no game logic.
- A module declares the contracts it provides statically
  (`const PROVIDES`, built with const `TypeId::of`, stable since Rust 1.91).
- The schema registers every provided contract first, in provider visit
  order, then the private components. A reader's key therefore exists
  before any module builds: one build pass, registry order free, contract
  cycles allowed. Rejected: a dry first pass, which breaks as soon as
  `build` branches on a contract.
- `b.provide::<C>() -> Own<C>` hands the pre-registered key to its declared
  provider. `b.contract::<C>() -> Option<Read<C>>` is `None` when no active
  module provides `C`; the reader degrades without a special branch.
- Build panics: a contract declared by two providers, a declared contract
  never taken, a name registered twice, a contract name bound to two types.
- `TypeId` only pairs a contract with its provider. It never enters a hash
  or a sort: its order changes between rustc releases.
- Cell columns follow the same rules: `b.cells(name)`, `provide_cells`,
  `contract_cells`. They replace `CELL_COLUMN: bool`. A cell is an untyped
  `u8`, so `cells` takes no type parameter: a cell contract carries only
  its name.
- `requires` returns keys the module holds, not strings.
- `Game::new` no longer takes a `SchemaBuilder`: the schema follows from the
  registry. Scenario fixtures that register `test.*` components become small
  test modules.
- The registry is a `macro_rules!` list: one line per mechanic.
- A module declares no events at build yet: core emits `Died` and
  `Spawned` only (§4). Module-declared events wait for their first reader,
  in `docs/ideas.md`.
- `korr_core::mechanic` re-exports `Own`, `Read`, `Component`, `Reader`,
  `Writer` and `Builder`. A mechanic depends on `korr-core` and
  `korr-contracts` only.

## 2. Access during a turn

- No ctx exposes `&mut Store`: `spawn` and `despawn` stay core-only. Ctxs
  offer `get(Read<T>, who)` and, in `commit` and ticks, `set`, `insert` and
  `remove` taking `&Own<T>`.
- `Seen` carries a crate-private `Handle`, valid for the turn. Reading a
  perceived entity's component costs no lookup: perception is the hot path
  (about 340 of fear's 450 ns per turn in TS).
- `Senses` extends to things (`Remains`) and to the contract cell columns
  within `SIGHT`.
- Owner requests, as planned in `rust-core-wander.md`: a contract declares a
  request; the owner validates it during the asker's `prepare` and applies
  it during the asker's `commit`, in the same action. Both happen or
  neither does. First case: hunger's `Graze` to flora. The owner runs no
  `prepare` or `commit` of its own: its `SERVES` carries a `check` and an
  `apply` on one cell value, and `PrepCtx::check` and
  `CommitCtx::order` reach them through two erased closures built per
  turn, one dyn call per request.
- A per-entity bulk tick joins the per-cell tick: a monomorphic loop over
  the module's own column, run in the environment phase. It writes only
  the row it iterates and pushes `harm`; kills and spawns stay deferred.

## 3. Entity references

- `Target` gains `Entity(EntityId)`. `Intent` and the `Traveller` row store
  the id only; a `Handle` is never saved, sent or stored in a component.
- The core resolves the id in `PrepCtx` through an open-addressing index
  `EntityId -> slot` in `korr-ecs` `Entities`, maintained by alloc, free and
  arrive, rebuilt on load, never saved and never iterated.
- Resolution applies the range rule: within `SIGHT` for creatures. A target
  that is dead, out of range or gone to another floor resolves to `None`
  and the run is `Fail`. Ids are never reused, so nothing clears targets on
  death.
- The index serves target resolution only, never `propose`:
  `rust-structure.md`'s "the hot path has no id index" still holds.
- Rejected: storing `(EntityId, Handle)` (breaks "a Handle is never saved",
  and generations are per store, so a foreign handle can match after
  travel); resolving through perception only (misses things and future
  player commands).

## 4. Lifecycle

- `vitality { hp, max }` is core-owned; no module writes it.
- `ctx.harm(target, amount, cause)` in `commit` and ticks pushes
  `(id, handle, cause, amount)` into a core buffer. `Cause` is
  `Entity(EntityId) | Mechanic(ModuleKey)`, so starvation is told apart.
- The buffer drains after each action, so the next actor sees the real
  state, and once after the whole bulk phase, so registry order never
  decides which cause kills. A drain sorts by (target, cause, amount), sums
  per target, and kills at `hp <= 0` with the lowest cause as credit.
- Deaths are handled in target id order, by direct core calls: drop (no-op
  until containment), remove its `Departure` (a departing actor can be
  harmed until the barrier), unlink from the grid, despawn (updates the
  index), request a `Remains` spawn, emit `Died`.
- `Remains { of: EntityId, mass }` is a new thing entity, not the corpse
  converted in place (which would keep every module column, satiety
  included). `mass` comes from a species value. A core bulk tick rots it
  each round and despawns it at zero.
- Schedule: a popped `Due { at, id, h }` runs only if the `clock` column of
  `h` still equals `at`. This skips the dead, recycled slots and entities
  killed by another actor or the bulk phase, without O(n) removal from the
  heap. The heap is rebuilt from `clock` on load. An actor that dies in its
  own action is not rescheduled.
- Spawns are deferred and sorted by (cause, key). Species initialisation is
  a core-only erased row write keyed by component id, like a `Traveller`
  attach: a documented exception to write authority. The catalogue feeds
  it later; test species feed it now.
- Events: one FIFO queue per floor, each event with its cause, a per-turn
  cap that panics, counted even when events are disabled. Core emits `Died`
  and `Spawned`; a module declares its own events at build. Only the host
  reads them, at the barrier drain. The queue is empty at every save, so
  the save format does not change.

## 5. Hunger

Crate `korr-hunger` in `biology/physiology/hunger`.

- Contracts provided: none. No `Edible` contract: no module reads it
  before fear. It waits in `docs/ideas.md`.
- Private: `Satiety`, and `Diet`, a mask of `PLANTS = 1` and
  `REMAINS = 2`. Reading unknown bits from a save is corrupt.
- Contracts read: flora's cell column (optional) and core `Remains`.
- Tick: `satiety -= decay`, and at zero push
  `harm(self, starve, Cause::Mechanic(hunger))`.
- Food: ripe plants, eaten through `Graze` (flora checks ripeness in its
  `prepare`, resets the cell in its `commit`, and returns the nutrition),
  and `Remains`, whose eaten mass is removed. No live prey: that is
  combat's.
- Decision: no proposal without `Satiety` and `Diet`, or at urgency 0.
  Urgency is computed from satiety in `propose`. Target: the
  nearest compatible food, ties broken by nutrition then id or position.
  Band `Routine`, weight from urgency; `Vigilance` below a critical
  threshold.
- Actions: `Eat(target)` when adjacent, else
  `Instead -> Approach(target)`, a greedy step. No pathfinding: noted in
  `docs/ideas.md`.
- Config, integers in `hunger/config.rs`: decay, urgency thresholds, eat
  cost, nutrition of plants and `Remains`, starvation damage.
- Without hunger, combat and fear read `None`. Without flora, hunger eats
  `Remains` only.

## 6. Tests and budget

Each test is written first and seen failing. Plausible bug caught in
brackets.

Seam:

- A reader listed before its provider builds with a valid key [a wrong key
  prefix].
- Two providers, or two types under one name, panic at build [an ambiguous
  contract accepted].
- Writing a component without its `Own` fails to compile, as a
  `compile_fail` doctest [a leak of write authority].
- A contract cycle builds [a hidden topological sort].

Scenarios, from a seed:

- A herbivore grazes and survives; the plant is gone [`Graze` not applied].
- Two rats, one ripe plant, same round [double consumption].
- A creature without food starves, leaves `Remains`, cause
  `Mechanic(hunger)` [a parallel death path, a lost cause].
- A carnivore eats `Remains`; its mass drops; it rots away [eternal
  carcasses].
- Prey killed after it declared a departure [panic at the barrier].
- An actor killed during its own action [panic on `insert(clock)`].
- An entity killed in the bulk phase before its `Due` pops [panic "a due
  actor is placed"].
- An `Entity` target dead, out of range, or gone is `Fail` [a read through
  a recycled slot].
- Hunger disabled, flora disabled, each alone: the game runs [a hidden
  dependency].
- Save and load mid-run with `Remains` and `Entity` targets gives the same
  hash [an index not rebuilt].
- Same hash with events on and off [events driving behaviour].
- Sequential and parallel runners give the same hash, extending
  `server/tests/threads.rs` [state shared across floors].

Budget, in the `core` bench (not part of `verify`, reported in the PR):

- `actor_turn` with hunger, real perception, P = 1: at most ~200 ns per
  entity decision.
- The id index under churn and lookup, measured before it is adopted (the
  `BTreeMap` lookup measured 43 ns).

## Deviations

- One cell column and at most one served request per module. A served
  request carries its `check` and `apply`: `serves::<C>(check, apply)`.
  A module cannot declare `SERVES` and keep a silent refusal.
- The mass of `Remains` is the dead creature's `Vitality.max`.
- `Appetite` left `korr-contracts` and became hunger's private `Diet`.
  Its `urgency` had no reader, so it is deleted. A type moves to
  `contracts/` only once a second module reads it: combat or fear will
  decide what they need.

## Open, deferred to combat

- Kill credit: lowest cause (kept from TS) or largest contributor. Matters
  only once credit has consequences.
- Target range for player input: `SIGHT` or floor-wide.
- Required contracts (`require::<C>()` failing the build) are not built:
  "runs with any module removed" needs optional reads only.

## Prior art

- Bevy: `Option<Res<T>>` for optional reads; `ComponentId` in registration
  order; 0.17 replaced its general second setup pass (`finish`) for
  arbitrary ordering. `Entity` is not synced between instances.
- bevy_replicon `ProtocolHash`, bevy_ggrs pitfalls: registration order must
  match, unregistered state desyncs silently.
- Factorio data stages: narrow ordered rounds instead of load-order
  dependencies.
- RimWorld: `GetComp` lookups became a perf hotspot; corpses are default
  food and the hunt job retargets to the corpse; needs tick in bulk.
- DCSS: persistent `mid` plus a cache rebuilt on load; deferred reset
  checked against the `mid`. Brogue: mark dying, remove after the loop.
- Dwarf Fortress: hunger counters tick every step. Species ALRE: every
  death becomes biomass.
