# Plan: generative species (v3, replan against the vision)

## 1. Inputs

- Target: `docs/plans/vision.md`. Binding research and decisions:
  `docs/plans/generative-species-research.md`.
- v2 of this plan. Its S1 is built on `feat/generative-species`: the
  Catalogue, the rat archetype, Expression rows on `size`, keyed draws,
  `herbivore.0`, `Snapshot.looks`, glyph by stem and case by tier. v2's
  later slices are replaced by the slices below.
- The research's binding constraint is memory (§0): per-individual genes
  must fit the unchanged 160 MB budget. The lever is a sparse storage kind
  (`ecs-core.md` D1), so rare components stop costing a column per slot.
- Audit gaps carried over from v2: density-dependent regulation, and the
  breed recheck under LOD replay.

## 2. Goal

A clean, high-performance structure that later bricks extend without
rework:

- Each individual carries a heritable u8 genome: stats, a verb bitmask
  drawn from a per-archetype pool, and temperament genes that weigh needs
  inside a band, never across bands.
- Mutation is keyed at the breed push. A taxon column and a census-based
  speciation label lineages.
- Genes and taxa persist across birth, travel, save and the season jump.
- The food web is legible: derived from `diet` and `edible` data and
  printed with populations.
- A new verb, archetype, social form or dungeon reaction is data or one
  module folder.

## 3. Success criteria

- `bun run verify` is green after every slice.
- A game saved and loaded plays on exactly as the unbroken run, with genes,
  verbs and taxa.
- Memory gate: the deterministic allocated-bytes row of
  `bench/reference.ts` sets the exit code (budget 137 MB, from S2). The
  RSS row stays measured and printed, report-only (see flagged decision 1).
- `bench/season.ts` runs from S3 on: time per round at P = 1/4/16/64,
  memory, id budget, and the P-fidelity check (KS rows per metric, gated by
  null, power and sanity calibration rows).

## 4. Slices

Each slice: behaviour + data + seeded test, a failing test first,
mutation checks named in the slice, `bun run verify` green.

1. **S1 Sparse storage kind on flora's sprout.** `core/ecs/sparse.ts`
   `SparsePool`: one pool per world, `SPARSE_CAP` (`CAP >> 3`) rows per
   floor shared by every sparse component. A u16 core column `rowOf`
   (local row + 1, 0 = none) is the only per-slot cost. Release
   swap-removes the floor's last row into the freed one. Module surface:
   `ModuleDef.sparse` and `Builder.sparse` returning `SparseColumns`.
   Persistence: a `POOL_COUNT` header word and one POOL section per pool
   column (`FORMAT_VERSION` 8), load checks in `persistence/sparse.ts`,
   audit of free pool rows. Non-actors only: actors, ranges and spawn
   values on sparse fields throw until S2. First, a pure move of
   `ModuleBuilder` to `setup/builder.ts`.
2. **S2 Sparse rows on travelling actors; allocated gate; read cost.**
   Inbox entries carry pooled words. The core `link` moves into the pool.
   Bench consumers `tracker` and `spring` turn sparse. A deterministic
   allocated-bytes row per owner gates `bench/reference.ts` at 137 MB.
   `bench/sparse.ts` prints ns per read for dense, view and pool paths.
   Genes and temperament stay dense; `ecs-core.md` D1 records why.
3. **S3 Early season bench.** `Engine.unwatchedPeriod`, a run parameter
   used by `startRound` when no player exists. `bench/season.ts` with
   time, memory, id-budget and fidelity modes. An integer two-sample KS
   compares each P against P = 1. `content/catalogue/web.ts` derives the
   food web. No World API change.
4. **S4 Heritable genes and budding.** A `gene` field kind (u8) marks
   heritable fields in any schema; `temperament.boldness` is the first.
   `core/heredity/genome.ts` copies and mutates the parent genome at the
   push of `WriteCtx.spawnKin`, with keyed draws and reflection at the
   bounds. Module `reproduction`: `bud`, the `breed` behaviour under
   hunger's fed state and local crowding (density regulation before
   `popCap`). `breed` rechecks its conditions in execute, so a cached
   intent replayed under LOD fails instead of breeding.
5. **S5 Verb pools and expression at birth.** A species verb pool lists at
   most `MAX_VERBS` (8) of its own components. Their mask bits are the verb
   genome, flipped per bit at birth. Expression rows (gene field to derived
   field) run at birth in `core/heredity/expression.ts`; module `physique`
   owns the `size` gene. The Catalogue emits rows instead of baked values.
6. **S6 Taxa and speciation.** A u16 core column `taxon`, carried and
   saved. `core/taxa/table.ts` holds the records; `core/taxa/census.ts`
   founds, joins and extinguishes taxa every `CENSUS_PERIOD` rounds from
   gene means and per-bit verb frequencies, with a split streak. The table
   is a world save section. Extinction is permanent.

Memory path (allocated bytes, reference world): about 142.3 MB today,
about 128.5 MB after S2, then S4 +4.1 (bud), S5 +0.82 (physique), S6
+1.64 (taxon) +0.2 (table): about 135.3 MB against 137. One more dense u8
gene fits; the next needs the CAP decision.

## 5. Decisions kept from the research

- Temperament moves scores inside a band, never across: it changes a
  threshold or a `band()` weight, never a raw score.
- Heredity is core: only the core may copy fields across every module's
  components at birth. Reproduction is a mechanic module.
- The census writes labels only. It reads gene columns and masks and
  decides nothing for a creature.
- Floors act as islands for the census, scanned in index order and
  independent of `floorOrder`.
- Every draw is keyed by name: adding a gene shifts no other gene's draw.

## 6. Seams kept open (research §3), not built

The user excluded groups, territories, relations, bonds and the dungeon
heart from this run. Their seams stay open:

- No group state anywhere: no group column, slot or key.
- The alarm byte keeps its bits untouched: the panic bit stays free.
- Class bits are unchanged: `diet.eats` and `edible.class` stay 8 bits.
- No core last-harmer record and no `ReadCtx` clock.

## 7. Deferred to the next run

- Predator and apex archetypes, and the hunter prey class (v2 D7).
- Bestiary, per-taxon Looks, stale bestiary entries.
- Voracity and curiosity genes: each costs 0.82 MB dense and waits for the
  CAP decision.
- The off-thread season-jump worker on the server.
- Pair crossover (two-parent heredity).
- Verb pool widening at speciation.
- Save migration by gene name.
- Points-form expression rows.

## 8. Flagged decisions (pending user)

1. **RSS budget.** The reference world already reads 165-168 MB running
   RSS against the 160 MB gate at baseline. The deterministic
   allocated-bytes row becomes the exit-code gate. The RSS row stays
   measured and printed, but report-only until the user decides.
2. **Lifetime id exhaustion (D2).** An origin floor allows 33,554,431
   births. `MAX_TICK` bounds a world to about 21.47M rounds. The taxa
   allow 65,535 lifetime u16 labels. Deferred, and budgeted by a
   `bench/season.ts` row. It must be decided before saves are frozen for
   permanent worlds.
3. **Season jump memory.** A save image is about 78 MB; RSS after a save
   is about 210-220 MB. The world, the checkpoint and the worker together
   exceed 160 MB. The server-side worker jump is deferred. Design note,
   from research §4 (the jump is a pure function image, rounds -> image,
   off the main thread; a failure rolls back to the input image):
   - Ownership: the server session owns the checkpoint, which is the input
     image. The engine keeps no copy.
   - Transfer: the session transfers a copy of the image to the worker
     and keeps the checkpoint. The worker returns a new image by transfer.
   - Rollback and lifetime: the checkpoint lives until the result loads
     and passes the full load check. A refused or failed jump drops the
     result and reloads the checkpoint. A loaded result frees the
     checkpoint.
   Which of the three copies may coexist is the memory decision.

Also flagged for later, with no decision needed in this run:

- `CAP` reduction as the memory lever after S6.
- Permanent extinction until the dungeon heart refills niches.
- The u16 taxa label budget (`TAXA_MAX` below 65,536); a split past it is
  refused and counted, never thrown.
