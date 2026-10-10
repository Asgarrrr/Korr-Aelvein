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

## 1. Principle

Each architecture rule becomes a crate boundary. A crate sees only what
its `Cargo.toml` declares, so a forbidden import is a compile error, not
a review finding.

## 2. Layout

```
apps/server-rs/crates/
├── sim/                      deterministic; sim/clippy.toml bans apply
│   ├── ecs/                  korr-ecs: ids, columns, storage; no dependency
│   ├── core/                 korr-core: grid, turns, arbitration, perception,
│   │                         health, death, containment, events, RNG, hash
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

- Dependency order: `ecs` < `core` < `contracts`, `genome` < mechanics <
  `catalogue` < `engine` < `scenarios`. A mechanic depends on `core`,
  `contracts` and `genome` only.
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
