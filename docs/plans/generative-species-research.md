# Research: generative species at scale

Input to the replan of `generative-species.md` against `vision.md`. Three
Opus research passes on 2026-10-09: genome, behaviour and social,
performance. Each claim below cites its source or a file. Estimates are
marked as estimates.

## 0. The binding constraint is memory

All three passes hit the same wall before any logic question.

- Every column is dense over floors × `CAP` (`core/ecs/storage.ts`,
  `CAP = 1 << 14`). At 50 floors, one u8 field costs ~0.82 MB and one i32
  field ~3.3 MB.
- Bench RSS is 158 of 160 MB, and the budget is never raised
  (`host-engine.md:252`, `generative-species.md:82`).
- Per-individual genes, a taxon column, verb components, group and bond
  fields all add columns. About four u8 genes fit today.
- Pages never touched may not count toward RSS. Measure one added u8 and
  one i32 field before deciding.

Decided with the user: build the sparse storage kind deferred in
`ecs-core.md` D1 (its trigger is "RSS over budget") before any
per-individual gene. The 160 MB budget stays. A gene then costs memory
only for the creatures that carry it. `ecs-core.md` rejected sparse sets
for 5x slower random reads: the replan measures that cost on the hot
paths and keeps the hot core columns dense.

## 1. Genome and heredity

Recommended:

- Haploid, fixed-length genome of named u8 genes, the union over all
  archetypes. A gene without rows for an archetype does nothing.
- Each gene is stored once, as a u8 field of a trait component, as
  `modules/temperament` already does with `boldness`. Derived fields (hp,
  bite) are written at birth.
- Expression rows compile per body and apply at birth through the D12
  values payload. Add a points row form for non-linear traits (like fear's
  `flightByBoldness`).
- Verbs: one bitmask gene per archetype. The body holds the full verb
  pool; expression only removes components whose bit is off.
- Mutation at the `breed` push, keyed by (parent id, time, gene name,
  litter index): floor-local and independent of floor order. Small
  symmetric integer steps. Reflect off the bounds, never clamp: clamping
  piles a population at the bound. Rates live in config; self-adaptive
  rates decay to zero.
- Pairs, later: uniform crossover by gene name. Never average parents:
  that halves the variance every generation.

Rejected: variable-length genomes (Creatures, Avida, NEAT: no typed-array
fit), diploid (double RSS, hides traits), one genome per species (no
individual temperament; kept only as a season-jump fallback).

## 2. Speciation

- A u16 `taxon` column per entity, carried and saved, monotonic, never
  reused, 0 for fixed species. `speciesIndex` stays the static body.
- A census every K rounds at a round boundary sums genes per (taxon,
  floor). Estimate: ~3M operations for 400k creatures.
- Split: a (taxon, floor) group with at least `minPop` members whose mean
  stays beyond distance T from the type genome for H censuses founds a
  taxon. Groups that drift together found one. Floors act as islands and
  stairs carry gene flow. Cap the living taxa.
- The taxon table (parent, origin, type genome, last mean, extinction) is a
  save section outside the Fingerprint. `catalogue(seed)` runs once at
  world creation and its founding taxa go into the save.
- A new taxon is named from its stem, seeded syllables and its most
  diverged gene. A bestiary entry is stale when the seen mean is far from
  the census mean.

Rejected: NEAT representatives (O(N·S), labels move with T), compatibility
graphs (O(N²)), a tree per individual (unbounded; a taxon tree suffices).

## 3. Behaviour and social

The current pipeline holds: needs, scored candidates, bands, core argmax.
It already is dual-utility reasoning (Dill): band = rank, score = weight.
Bands plus `INERTIA` give the commitment HTN planners had to add.

- Temperament moves scores inside a band, never across: it changes
  thresholds or the `band()` weight, never a raw score.
- Social facts reach a decision only through perception and contract
  views, cell fields stamped in ticks, or the actor's own columns. Events
  never feed a decision.
- Groups emerge from individuals reading a membership view. No group
  entity that decides: it breaks when members split across floors.
- Multi-turn work is a chain of one-turn goal actions with progress in a
  column. Every step costs one turn (fear's `MARGIN`).
- The dungeon is one heart actor per floor, with need columns, proposing
  spawn and fill candidates through the same arbitration. It spawns mutant
  individuals; it never changes the catalogue.

Seams per brick:

| Brick | Seam |
|---|---|
| Temperament | Nothing in core; each consuming module owns its curve |
| Groups | Stateless kin (lowest id in sight leads) or a u16 group slot; a group key for the `decide()` stagger; a panic bit in the alarm byte |
| Territories | One owned cell field, cleared and refilled by max over packed (strength, owner) |
| Relations | Niche × niche table of a small enum, keyed by archetype; widen class bits past 8 |
| Bonds | A `ReadCtx` clock, a core last-harmer record, floor-aware liveness |
| Following, scavenging | A neutral view of another actor's intent: target id and band |

Rejected: GOAP/HTN as decider (a parallel decision system), RimWorld job
steps (second commitment mechanism), diffused influence maps (whole-grid
pass per faction), a world-level director (breaks D3; L4D paces a player,
and a season jump has none).

## 4. Performance and the season jump

- The bench does not measure a jump: it keeps two players, so 39 floors
  run at P=64. With no player, `startRound` sets P=1 everywhere
  (`core/turns/round.ts:9-23`).
- Estimate: ~136 ms a round for 40 dense floors at P=1, so ~2.3 min per
  1,000 rounds single-threaded. Lower density shrinks it linearly; each
  new mechanic adds to every decision.

Levers by gain/cost: fewer rounds per season (selection needs generations,
not rounds) → a season decision period, validated against P=1 → floor-
parallel workers → JS profiling → a WASM port, last.

Build early:

- `bench/season.ts`: 40 floors, density gradient, no player, events off,
  2,000 rounds, P = 1/4/16/64. Report total time, ms per round over time,
  per-floor spread, RSS.
- A fidelity check: species counts and mean genes over 20 seeds, each P
  against P=1.
- The jump as a pure function (image, rounds) → image, off the server's
  main thread. A failure rolls back to the input image.

Seams: keep `createColumn` and `Storage` the only allocators (a shared
buffer later); `Inbox.post` writes another floor mid-round, which is a race
under workers, so workers need an outbox merged at the round barrier; a
test that any partition of floors into k groups gives the same hash.

Rejected: aggregate population models (lose per-individual genomes, and
they are a parallel decision system), another ECS library (same SoA, within
1.5×), WASM now (tuned JS matched it; callbacks cross the boundary),
parallelism inside a floor (breaks one-at-a-time action).

## 5. Failure modes to test against

- Runaway traits: a gene with benefits only goes to its bound. Every gene
  gets a cost row; a test keeps the census mean off the bound.
- Evolution too slow to see: express T in mutation steps; test that
  generations per season × drift reach T; carry visible change on verbs.
- Taxon explosion: `minPop`, hysteresis H, a cap on living taxa.
- Clonal collapse under budding: mutation rate above 0; refill empty
  niches from the last type genome.
- Zeroed child genome: deferred kills run before spawns and recycle slots,
  so copy the genome when the spawn is pushed.
- Contagion cascade (Dwarf Fortress tantrum spirals): edge-triggered
  stamps, a refractory column, decay on the clock.
- Band inflation: one reviewed band per need, in config.
- Far-floor pack desync at P=64: a group stagger key or an alarm wake.
- Reverted labels: refuse a `loadFloor` image older than the last census.
- Permanent-world saves: the first new gene changes the Fingerprint. A
  save migration by gene name is needed before the first persisted world.

## Sources

Genome: creatures.wiki/GEN_files, creatures.wiki/Genetics,
github.com/qwfy/rtNEAT, neat-python docs, Thrive wiki and devblog 20,
speciesdevblog.wordpress.com/2012/03/20/speciation, raphkoster.com (UO
ecology), dwarffortresswiki.org/index.php/Genetics, github.com/joyhughes/
polyworld, arxiv 2105.06757, 2204.04817, 1709.04416, 2405.10183,
github.com/emilydolson/phylotrackpy, discoveralbia.com (Norn gene pool).

Behaviour: GameAIPro2 ch. 3 (dual utility) and ch. 30 (influence maps),
GameAIPro ch. 12 (HTN), Zubek needs-based AI, gameai.com/iaus.php,
gridsagegames.com living dungeon, rainworld.miraheze.org/wiki/Behavior,
dwarffortresswiki.org Mental_breakdown, Booth L4D AI (Valve 2009),
wiki.cavesofqud.com Factions and Creature_AI, RimWorld mod guide.

Performance: rainworld.miraheze.org Abstractization, Tarn Adams Q&A
(gamedeveloper.com), jasss.org/23/4/14, github.com/noctjs/ecs-benchmark,
mrale.ph (Rust vs JS), fitzgen.com, arxiv 1901.09056,
benchmarkingwasm.github.io, factorio.com FFF-364 and FFF-415, bun.com
workers docs, oven-sh/bun#15964.
