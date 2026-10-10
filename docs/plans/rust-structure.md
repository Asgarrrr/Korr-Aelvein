# Plan: Rust workspace structure

Inputs: the TS engine layout, `docs/plans/vision.md`, `docs/ideas.md`,
and fictional features used to test each boundary; an `advisor` review
of crate granularity, clippy config, cycles and filing.

User decisions:
- The engine and the server move to Rust; the web stays in TS.
- Mechanics are grouped by domain. The living domain is named `biology/`.
- The foundation keeps the name `core`.
- `play/` is dropped: the player is an actor with a recorded input.
- Combat is a full system of its own (attacks, spells), not an extension
  of predation.

## 0. Approach

- The Rust engine is written natively, not translated. The TS code is a
  reference to read; its scenario tests are the behaviour to reach.
- No bit-exact hash parity with TS. The Rust engine pins its own world
  hash per seed for determinism.
- Foundations first, each a leaf with a fixed contract and its own tests:
  RNG (counter-based draws), entity ids and storage, grid. Storage stays
  minimal until `wander` shapes its queries.
- Then one small mechanic at a time, each finished with its scenarios
  before the next: turns and arbitration with `wander`, then `flora` (module interface extracted),
  then `hunger` (core API frozen), then `temperament`, `explore`, `fire`,
  `fear`.
- Floor parallelism is not built first. A floor owns all its state and
  reaches other floors only through its inbox, so it stays possible.
- The TS server keeps serving the game until the Rust engine runs the
  starter floor with a player.

## 1. Principle

Each architecture rule becomes a crate boundary. A crate sees only what
its `Cargo.toml` declares, so a forbidden import is a compile error, not
a review finding.

## 2. Layout

```
apps/server-rs/crates/
├── sim/                      deterministic; sim/clippy.toml bans apply
│   ├── random/               korr-random: counter-based draws; no dependency
│   ├── ecs/                  korr-ecs: ids, columns, storage; no dependency
│   ├── core/                 korr-core: grid, turns, arbitration, perception,
│   │                         health, death, containment, events, hash
│   ├── contracts/            korr-contracts: types read by 2+ mechanics, no logic
│   ├── genome/               korr-genome: genes, crossover, mutation, expression rows
│   ├── biology/              mechanics about a creature: its actions or its components
│   │   ├── physiology/       hunger, thirst, metabolism, thermo
│   │   ├── ontogeny/         age, growth, reproduction
│   │   ├── ethology/         fear, temperament, wander, explore, social, territory
│   │   └── cognition/        memory, learning
│   ├── milieu/               mechanics that only own cell fields: fire, flora, scent, tide, light
│   ├── combat/               attacks, spells, status effects
│   ├── catalogue/            archetypes, species table
│   ├── worldgen/             (seed, params) -> floor layout and niche spawn slots
│   ├── engine/               korr-engine: registry and the Game facade
│   └── scenarios/            every engine scenario test
└── host/                     impure: network, clock, disk, threads
    ├── protocol/             web <-> server messages; generates the TS types
    ├── meta/                 per-account progression: bestiary, island, unlocks
    ├── server/               axum, sessions, the simulation thread, persistence
    └── tools/sim-cli/        headless: season jump, bench, TS parity, map preview
```

Each leaf under `biology/`, `milieu/` and `combat/` is one crate per mechanic, for
example `sim/biology/physiology/hunger/` is `korr-hunger`.

## 3. Rules

- Dependency order: `random`, `ecs` < `core` < `contracts`, `genome` < mechanics <
  `catalogue` < `engine` < `scenarios`. A mechanic depends on `core`,
  `contracts` and `genome` only. Only `core`, `genome`, `worldgen` and
  host tools depend on `random`: a mechanic draws through its `core` context, so it
  cannot forge another module's stream.
- A mechanic about a creature, its actions or its components, goes in
  `biology/`, even when it also owns cell fields (fear owns `danger`,
  `alarm`, `presence`). A mechanic that only owns cell fields goes in
  `milieu/`. Attacks, spells and their effects go in `combat/`.
- Domain folders are filing, not layers. There is no shared crate per
  domain.
- No parallel system for the player. The player is an actor with a
  recorded input: items, traps and taming are filed by the rule above.
- Combat serves every actor. A creature and the player use the same
  attacks and spells; the player picks from input, a creature from scored
  candidates. Damage goes through core `harm` only.
- Reproduction depends on `genome`. At world build, `engine` compiles the
  expression rows into a table keyed by component id; core spawn takes a
  species reference and a genome. No birth hook.
- `worldgen` depends on `core` only. It knows niches, not species;
  `engine` maps niches to species.
- `host/meta` reaches the simulation only as recorded run parameters or
  inputs, so replays and echoes stay deterministic.
- `host/protocol` is the source of the message types. `packages/protocol`
  holds the generated TS types.

## 4. Build and tooling

- Cargo errors on a glob match without `Cargo.toml` (cargo#11405). List
  `members` by depth: `crates/sim/biology/*/*`, `crates/sim/milieu/*`,
  `crates/sim/combat/*`,
  and each other crate by path.
- Scenario tests need the catalogue and the registry, and a dev-dependency
  on `engine` from a mechanic compiles it twice (cargo#6765). All scenario
  tests go in `sim/scenarios`. Mechanic crates set `test = false` and
  `doctest = false`.
- Release profile: `lto = true`, `codegen-units = 1`. Hot `ecs` and `core`
  accessors are `#[inline]`: rustc does not inline across crates by itself
  under incremental builds, or for functions that contain a call.
- Clippy finds the nearest `clippy.toml` walking up from the crate and
  never merges files. A check script asserts exactly one `clippy.toml`
  under `sim/` and no `CLIPPY_CONF_DIR`.
- A crate cannot add lints to `lints.workspace = true` (cargo#13157). The
  same script asserts `#![deny(clippy::float_arithmetic)]` in every sim
  `lib.rs`.

## 5. Boundary test with future features

| Feature | Location |
|---|---|
| Biomes, rivers across floors | `sim/worldgen`, floor links through `core` travel |
| Rising tide, spreading fire | `sim/milieu/tide`, `sim/milieu/fire` |
| The dungeon spawns defenders, sets traps | `sim/biology/ethology/dungeon`: an actor with needs |
| Factions, territories, packs, taming | `sim/biology/ethology/social`, types in `contracts` |
| Mutation, speciation | `sim/genome`, `sim/biology/ontogeny/reproduction` |
| Player attacks and spells | `sim/combat/*`, shared with creatures |
| A venomous species bites | `sim/combat/status`, genes set its venom |
| Season jump after death | pure function in `engine`, run off-thread by `server` |
| Bestiary that ages with evolution | `host/meta` and `host/protocol` |
| Island seeds planted in the dungeon | `host/meta` -> run parameters -> `sim` |
| Echoes of past runs | recorded inputs in `server`, replay in `engine` |
| Island hub in real time | open: second simulation or a `core` mode |

## 6. Open points

- How predation in hunger and the combat attacks share a kill: the hunt
  motive stays in hunger, the attack itself moves to `combat`. To settle in
  the combat plan.
- The workspace folder name once the TS server is gone.
- No `EntityId` -> `Handle` index exists yet for components that reference
  other entities.

## 7. korr-ecs

`apps/server-rs/crates/sim/ecs`, no dependency. It stores entities and
their components; it imports no workspace crate.

### Storage decision

A throwaway spike (`/tmp/korr-ecs-spike`, 10k and 50k entities, not kept)
compared dense `Option` columns indexed by slot with sparse sets:

| Workload | Result |
|---|---|
| Actor turn, dense columns and sparse sets | 6-10 ns, no clear winner |
| Actor turn through a `dyn` downcast per column | 16-23 ns |
| `BTreeMap` lookup from `EntityId` to slot | ~43 ns |
| Sparse-set bulk iteration | ~0.01 ns/row, likely inflated by loop folding |

- The hot path has no id index: an actor turn reads through a `Handle`,
  never through an `EntityId` lookup.
- The downcast is paid once per call, at a column lookup, never per row.
- Slice 6 reproduces this decision with criterion benchmarks. Until then
  the column is a stub, `Vec<Option<T>>` by slot.

### Ids

An `EntityId` is a `u64`, never reused, kept across floors, saves and
snapshots:

```
bit 63      always 0, so the id is a valid korr-random subject
bits 62..47 origin floor (FloorId, u16)
bits 46..0  counter, monotonic per origin floor
```

Ordering follows the bits: origin floor first, then counter.

### Handle

A `Handle` is a slot and its generation. It is valid only on the `Store`
that returned it: never stored across floors, saves or the network.
Free slots go on a LIFO stack, so slot reuse is deterministic. A free
bumps the generation; at `u32::MAX` the slot retires instead of wrapping,
so a stale handle never comes back to life.

### Schema

`SchemaBuilder::register::<T>(name)` returns a typed `ComponentKey<T>`.
Its id is the registration index; a name is registered once and is never
empty. `Schema` is the ordered list of registered components, shared by
every floor of a world. A `Store` holds one floor: its entities and one
type-erased column per component, in schema order. A key used on a store
of another schema panics.

### Borrowed pieces

Ideas only; no upstream code is copied. slotmap (Zlib) is excluded.

| Piece | Source | Why it fits |
|---|---|---|
| Generational slot allocator with a LIFO free list | thunderdome 0.6.1, hecs 0.11.2 (MIT OR Apache-2.0) | O(1) spawn and despawn, deterministic reuse. Both wrap the generation; korr-ecs retires the slot instead |
