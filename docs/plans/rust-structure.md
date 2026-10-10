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
│   ├── ecs/                  korr-ecs: ids, columns, storage; thiserror only
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
    └── tools/
        ├── sim-cli/          headless: season jump, bench, TS parity, map preview
        └── ecs-bench/        korr-ecs-bench: criterion benches of korr-ecs against hecs and bevy_ecs
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

`apps/server-rs/crates/sim/ecs`. Its only dependency is thiserror 2.0.21
(MIT OR Apache-2.0, `default-features = false`, so `no_std`). It stores
entities and their components; it imports no workspace crate.

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
- Each column is a sparse set, see Column below. The presence benchmark
  in Benchmarks settles this choice over dense columns.

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

### Column

A `Column<T>` holds one component's values on one floor, as a sparse set:
`sparse` maps a slot to a dense index (`u32::MAX` when absent), `dense`
packs the values, and `owners` maps a dense index back to its slot. Insert
appends; remove does a `swap_remove` and points the moved owner's sparse
entry at the hole. Dense order depends only on the sequence of operations,
so it is deterministic. `sparse` grows on insert and never shrinks.

`Store::values` and `values_mut` expose the packed values in dense order.
`values_mut` gives no access to owners, so a bulk tick writes only the
rows it iterates. `Store::iter` yields each holder's `Handle` with its
value.

### Join

`Store::join(a, b)` yields `(Handle, &A, &B)` for each holder of both
components. `Store::join_mut(a, b, f)` calls `f(Handle, &mut A, &mut B)`
on the same rows. Both walk the dense order of `a`, the first key, so the
order is predictable from one column: put the rarer component first. The
same key on both sides, or a key from another schema, panics.

`join_mut` borrows the two columns through `<[T]>::get_disjoint_mut`
(std, stable since 1.86), so it needs no `unsafe`. `f` cannot reach the
`Store`, so the borrow checker rules out structural changes during a join:
a caller collects the handles to kill and applies them afterwards. There
is no N-ary query until a mechanic needs one.

### Views (not exported)

A view resolves a column once, so later lookups skip the bounds check and
the `dyn Any` downcast. The experiment was `Store::split_mut(key)`, which
takes one column as a `ViewMut` and returns the others as `Rest`, from
which `Rest::view(key)` makes a read-only `View`. Each lookup still
checked liveness, so a stale handle to a reused slot gave `None`. Views
held slices, not a `&Column`: a write through the `ViewMut` otherwise
makes every `View` reload its column (measured 6.28 against 5.72 µs).

A creature acts alone on the current state, and may spawn or despawn
between two turns, so an actor turn cannot keep views from an earlier
turn. The engine can resolve views only inside one turn: one `split_mut`
per pick. Median time per call, 1,000 picks, against the same code before
the experiment:

| Layout | `presence/actor_turn` ours | `actor_turn` ours (2 floors) |
|---|---|---|
| `Store::get` (before) | 10.4 µs | 3.89 µs |
| one `split_mut` and 5 views per pick | 27.3 µs (+160%) | 4.41 µs (+13%) |
| views resolved once per 1,000 picks, not reachable by the engine | 6.80 µs (-35%) | not measured |

Gate: the per-pick layout had to be at least 15% faster than `before`. It
is 2.6x slower on 30 columns: each pick resolves the same six columns as
six `get`s, and adds the split. No view is reused. The `View`, `ViewMut`, `Rest` and `split_mut`
types are therefore not exported and the experiment is deleted. Views only
pay off when one turn reads many entities through one view. No such
caller exists yet, so they are not exported. The hoisted row shows the
ceiling: it is a layout the engine cannot use.

Kept from the experiment: `column.rs` owns the single `dyn Any` downcast
(`typed`, `typed_mut`), the sparse lookup (`find`) and `FOREIGN_KEY`;
`join_mut` reuses `typed_mut`. `Store::get` and `get_mut` are unchanged.
Adding the `assert_backends_agree` guard to `benches/presence.rs` moved
that binary's `actor_turn/ours` from 10.4 to about 11.3 µs with the library
code unchanged. Read the 10.4 µs figures above as the before value, not as
a regression of the library.

### Image

`Store::save` writes one floor as an image; `Store::load(schema, bytes)`
reads it back. The image keeps every slot, the free stack and each
column's dense order, so a reloaded floor hands out the same slots and
replays identically. The whole-world save is the list of floor images
plus the travellers in flight; korr-engine assembles it.

Every component implements `Component`: `write(&self, &mut Writer)` and
`read(&mut Reader) -> Result<Self, ImageError>`. `read` is a pure
function of the bytes and consumes exactly what `write` produced. The
codec is hand-written little-endian; the checksum is FNV-1a 64.

There is no derive or macro codec. Generated field-order code ties the
v1 layout to the declaration order of the fields, so swapping two fields
writes a valid-checksum image with swapped values. `codec.rs` keeps
hand-written little-endian code by decision.

Image v1, little-endian:

```
magic         8 bytes   b"KORRFLR\0"
version       u16       1
floor         u16
next_counter  u64
slot count    u32, then per slot:
                generation u32, state u8 (0 dead, 1 alive), id u64 when alive
free count    u32, then each slot u32, bottom of the stack first
column count  u32, then per column in ComponentId order:
                name length u16, name bytes, row count u32,
                then per row in dense order: owner slot u32, T::write
checksum      u64, FNV-1a 64 over every preceding byte
```

`load` checks, in this order, and returns the first failure:

1. Fewer than 28 bytes: `Truncated`.
2. The checksum, before any parsing: `Checksum`.
3. The magic: `Magic`. The version: `Version`.
4. A state byte other than 0 or 1: `Corrupt("slot state")`.
5. An id with bit 63 set: `Corrupt("entity id")`.
6. An alive id seen twice: `Corrupt("duplicate entity id")`.
7. An alive id from this floor whose counter is not below `next_counter`:
   `Corrupt("id beyond the floor counter")`.
8. A free entry out of range, alive, retired or repeated, or a dead
   non-retired slot missing from the free stack: `Corrupt("free list")`.
9. A column count or name that differs from the schema: `Schema`.
10. A row owner out of range, dead, or repeated in its column:
    `Corrupt("column owner")`.
11. Errors from `T::read`, propagated.
12. Bytes left over: `Trailing`.
13. `next_counter` past 2^47, a state no live store reaches, where the
    next spawn could not name its entity: `Corrupt("floor counter")`.
    It runs last so checks 1 to 12 keep their order.

`load` never reserves capacity from a count it has not verified: it
pushes while reading, so a huge count ends in `Truncated`.

`Entities` writes and reads `floor`, `next_counter`, the slot table and
the free stack; `Store` holds neither field. `Entities` owns admission:
checks 5 to 8 and 13 run inside it, and check 7 is the only copy of the
id-versus-counter rule.

### Travel

`Store::detach(h)` takes an entity off its floor as a `Traveller`: its
`EntityId` and its row, encoded per column with the image codec. Every
component leaves with it, and its slot is freed as by `despawn`.
`next_counter` is untouched, so the id is never reused on that floor.
`Store::attach(t)` puts the traveller on a floor under the same id, in a
fresh slot; attaching back onto the origin floor is valid.

A traveller encodes for the inbox korr-engine saves, little-endian:

```
id         u64
row length u32, then the row:
  column count u32, then per column in ComponentId order:
    0u8 when absent, or 1u8 followed by T::write
```

`Traveller::read` checks only the id bits (`Corrupt("entity id")`) and
the length. `attach` is all or nothing: it validates the whole row before
it changes anything, so on `Err` the store is unchanged. It checks, in
this order:

1. An id from this floor whose counter is not below `next_counter`:
   `Corrupt("id beyond the floor counter")`.
2. A column count that differs from the schema: `Schema { index: count }`.
3. A presence byte other than 0 or 1: `Corrupt("presence")`.
4. Errors from `T::read`, propagated; the values are dropped.
5. Bytes left over: `Trailing`.

Only then does it allocate the slot and read the row a second time to
insert it. The second read cannot fail because `Component::read` is pure.

`Entities` owns admission. `Entities::admit` runs check 1 and returns an
`Arrival`, which only it can build; `Entities::arrive` takes that
`Arrival` and allocates the slot. `Entities::spawn` is the only issuer of
new ids on a floor.

World invariant, documented and not checked, since a check costs O(n): an
`EntityId` is alive on at most one floor, and a detach always precedes its
attach. A violation, such as attaching one id twice, makes `save` write an
image that `load` rejects; `Traveller` is not `Clone` so that one value
cannot attach twice, but reading the same bytes twice can.

### Benchmarks

`apps/server-rs/crates/host/tools/ecs-bench` (`korr-ecs-bench`) runs five
workloads on four backends through one `Backend` trait: korr-ecs (`ours`),
hecs 0.11.2, bevy_ecs 0.20.0 (`bevy`) and `dense`, a minimal candidate with
generational slots and one `Vec<Option<T>>` per component. hecs, bevy_ecs
and criterion 0.8.2 are MIT OR Apache-2.0 and serve only as baselines; the
crate is outside `sim/`, so the wall-clock bans do not apply.
The presence benchmark keeps its own `Backend` trait: only `churn` and
`actor_turn` have matching signatures. `populate`, `bulk` and `query`
differ, and presence has no `travel` or `checksum`. One shared trait would
force 30-column work on hecs and bevy.
`tests/equivalence.rs` runs the same op sequence on all four backends, seeds
1 to 3, and compares the actor-turn sum and a checksum of every entity after
every op, so a timing difference is never a behaviour difference.

Run: `cargo bench -p korr-ecs-bench --bench ecs` in `apps/server-rs/`. It is
not part of `verify`.

Setup: 20,000 entities on floor 0, 1,000 picks from seed 1 (repeats
possible), each backend populated once per bench function and measured over
its persistent state. Every entity has `Pos` and `Hunger`; even indices also
have `Vel`. Release profile with `lto = true` and `codegen-units = 1`.
Measured 2026-10-10 on Apple M5 Pro, macOS (Darwin 25.5.0), rustc 1.96.1,
full run (not `--quick`). Value: criterion's median, divided by the elements
per iteration.

| Workload (elements) | ours | hecs | bevy | dense |
|---|---|---|---|---|
| churn: despawn and respawn (1,000) | 26.1 ns | 34.8 ns | 48.7 ns | 7.83 ns |
| actor_turn: read, write by handle (1,000) | 4.01 ns | 7.20 ns | 5.39 ns | 1.89 ns |
| bulk: every `Hunger`, 2 floors (20,000) | 0.0141 ns | 0.221 ns | 0.241 ns | 0.240 ns |
| query: `Pos` and `Vel` (20,000) | 0.567 ns | 0.163 ns | 0.258 ns | 0.374 ns |
| travel: floor to floor (1,000) | 66.3 ns | 37.2 ns | 45.4 ns | 7.08 ns |

Budget: `actor_turn` is the proxy for a cached actor turn. korr-ecs spends
4.0 ns per turn on it, 3.3% of the ~120 ns budget, which leaves about
116 ns for the rest of the turn. The 20,000 entities take
in korr-ecs a little over 1 MB, so the picks probably hit the L2 cache; a
floor much larger than the cache would cost more.

Build time, cold `cargo clean && cargo test --workspace --locked`, same
machine: 6.9 s before adding the crate, 14.2 s after. `verify` now builds
bevy_ecs and hecs for the equivalence test and for `clippy --all-targets`.

Fairness notes:

- bevy pays change detection: each `Mut<T>` write sets a tick. Its
  `QueryState`s are built once in `populate`, so queries do not pay for
  state creation.
- ours pays serialization in `travel`: `detach` encodes the row and `attach`
  checks it, then reads it again. hecs moves the row between worlds without
  encoding it. A traveller in flight is the form the inbox saves.
- hecs and bevy are archetype stores. Their `query` and `bulk` read a
  contiguous table per archetype; the benchmark has two archetypes, with and
  without `Vel`, so they never see the cost of many component sets.
- `query` counts all 20,000 entities as elements, but half have `Vel`. Read
  its figures as relative, not as a rate per matching row.
- `Hunger` reaches 0 after at most 100 `bulk` calls and stays there. The
  `saturating_sub` loop is branch-free, so this does not change timing.
  ours iterates a packed `u16` slice, which the compiler probably
  vectorizes; the other three probably do not. The 0.0141 ns is a property
  of that loop, not a rate other loops reach. The earlier spike saw ~0.01 ns.
- `dense` is the lower bound for random access: no sparse lookup, no
  serialization. It keeps no `EntityId`, no image and no travellers.

On this population `dense` wins four workloads: `actor_turn` 2.1x,
`churn` 3.3x, `query` 1.5x and `travel` 9.4x. Every entity has two or three
of three components, the case that favors dense columns.

Presence benchmark (`cargo bench -p korr-ecs-bench --bench presence`),
same machine. One floor, 20,000 entities, 30 components: two on every
entity, the other 28 on about 7% each. Median time per call:

| Workload | ours | dense | Winner |
|---|---|---|---|
| `churn`, 1,000 despawn + respawn | 124 µs | 205 µs | ours 1.7x |
| `actor_turn`, 1,000 turns of 6 reads + 1 write | 10.3 µs | 3.39 µs | dense 3.0x |
| `bulk_full`, decay a component every entity has | 0.57 µs | 4.86 µs | ours 8.5x |
| `bulk_sparse`, decay a 7% component | 0.043 µs | 11.2 µs | ours ~260x |
| `query_sparse`, join two 7% components | 0.72 µs | 12.3 µs | ours 17x |

Decision: sparse-set columns. Bulk ticks and joins scale with present rows,
not with slots times components, and churn no longer pays for 30 absent
columns. Dense keeps random access: ~10 ns against ~3.4 ns per actor turn.
Both stay under 10% of the 120 ns cached-turn budget. `bulk_sparse` touches
~1,400 packed `u32`s that the compiler probably vectorizes, so read it as a
ratio, not a rate.

Against the TS engine storage (`bun bench/presence.ts` in
`packages/engine`), same population and machine, Bun 1.4.3. The TS
`SparsePool` holds 2,048 rows per floor for all sparse components, and
~87% of these entities hold at least one, so the TS side uses its dense
typed-array columns, mask bits and `MaskQuery`. `CAP` is 16,384 slots per
floor, so the TS population spans two floors of 10,000. Median of 50
batches of 20 ms after warmup, storage only, not a whole-engine figure:

| Workload | Rust ours | TS | Winner |
|---|---|---|---|
| `churn` | 130 µs | 174 µs | Rust 1.3x |
| `actor_turn`, checked (Rust handle, TS `slotOf` by id) | 10.2 µs | 5.24 µs | TS 2.0x |
| `actor_turn`, TS by slot, no liveness check | — | 2.35 µs | — |
| `bulk_full` | 0.56 µs | 11.8 µs scan, 18.3 µs `MaskQuery` | Rust ~21x |
| `bulk_sparse` | 0.043 µs | 8.07 µs | Rust ~190x |
| `query_sparse` | 0.71 µs | 7.60 µs | Rust 10.7x |

The TS store scans every slot up to its high-water mark and tests a mask
word; the Rust store walks only present rows. Rust loses random access
mainly because each `get` finds its column again (bounds check, `dyn Any`
downcast) before the liveness check and the sparse lookup. An earlier
experiment, not kept, split the 6 reads and 1 write of an actor turn: 6
`get`s took 11.46 µs, the same without the liveness check 10.28 µs, views
resolved once 4.12 µs, and dense 3.09 µs. The per-call column lookup
dominates; liveness costs about 1.2 µs.

Open points from the results:

- `query`: the two-key join is 3.5x slower than hecs and 2.2x slower than
  bevy, because it does a sparse lookup per row of the first key. Not
  optimized in this slice.
- `travel`: 66 ns against 37 ns for hecs, the price of the encoded row. A
  crossing is rare next to an actor turn, so there is no per-turn budget to
  miss. Not optimized in this slice.

### Borrowed pieces

Ideas only; no upstream code is copied. slotmap (Zlib) is excluded.

| Piece | Source | Why it fits |
|---|---|---|
| Generational slot allocator with a LIFO free list | thunderdome 0.6.1, hecs 0.11.2 (MIT OR Apache-2.0) | O(1) spawn and despawn, deterministic reuse. Both wrap the generation; korr-ecs retires the slot instead |
| Sparse set with `swap_remove` fixup | shipyard 0.11.5, sparsey 0.13.4 (MIT OR Apache-2.0); the idea originates in EnTT (MIT) | O(1) insert, remove and lookup by slot; values packed for bulk ticks. Design only, no copied code |
| Two-key join through `<[T]>::get_disjoint_mut` | std 1.86; replaces the unsafe aliasing of bevy_ecs and hecs queries | Two mutable columns without `unsafe` and without a runtime borrow check per row |

Measured, not borrowed, from the benchmarks above:

| Piece | Source | Result |
|---|---|---|
| Archetype tables, rows moved on every component set change | hecs 0.11.2, bevy_ecs 0.20.0 | `query` is 2.2 to 3.5x faster than ours; `actor_turn` takes 1.3 to 1.8x ours, `churn` 1.3 to 1.9x ours. Open until the many-component rerun |
| Per-write change detection ticks | bevy_ecs 0.20.0 | Not built: no mechanic reads a change flag, and every write would pay a tick |
| Two worlds, entity moved by `take` and `spawn` | hecs 0.11.2 | Baseline for `travel` only; ours encodes the row because a traveller can be saved |

hecs and bevy_ecs are dependencies of `korr-ecs-bench` alone; neither
reaches `sim/`.

Rejected: shipyard 0.11.5 drives a join from its shortest column. Its
order flips when column lengths cross, so a mechanic would see a different
order after unrelated spawns. korr-ecs always drives from the first key.
