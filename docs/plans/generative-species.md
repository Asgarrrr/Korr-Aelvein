# Plan: generative species (v2, after advisor review and plan audit)

## 1. Inputs

- The user request: design an end-to-end structure for a generative
  biological model of creatures. This is a replan.
- The first plan (6 slices: catalogue, physiology, food web, reproduction,
  depth, bosses), its audit and its council points
  (`/tmp/korr-plan/generative-species-plan.json`). Its verified code facts
  and the decisions not contradicted below are kept.
- An `advisor` review, verified in code:
  - Every gate of the first plan was a simulation gate. Player perception
    had no criterion.
  - The snapshot sends `[id, species, x, y]`
    (`packages/protocol/src/index.ts`). The web maps glyphs by species name
    (`apps/web/src/theme.ts`) and edibility by name
    (`apps/web/src/input/keys.ts`). A generated name has no glyph.
  - Role mixed two axes: trophic place and standing.
  - Food classes are u8 bits (`diet.eats`, `edible.class`); fear cell
    fields and `Builder.alarm` are u8-only (`core/module/api.ts`). One bit
    per trophic level wastes the budget of 8 bits.
  - A bite equal to the eater's `vitality.max` one-shots the 10-hp player
    at every depth. Fear ignores size (`modules/fear/sense.ts`). A speed
    gene breaks fear's `MARGIN` (`modules/fear/config.ts`).
  - The simulation is invisible: the starter world runs with
    `events: false` (`world/starter.ts`), the snapshot holds no events, and
    the server sends floor 0 only (`apps/server/src/session.ts`).
  - Breeding costs the parent nothing; only `popCap` bounds births
    (`core/lifecycle/lifecycle.ts`). Herbivores can strip the player's
    floor of forage.
  - 5 niches x 16 strata x 3 + 16 bosses + 7 fixed = 263 species, above
    `MAX_SPECIES` (255, `core/config.ts`).
  - Saves die when the generator changes. Acceptable while nothing is
    persisted.
- Plan audit gaps of the first plan: no birth-time values path for mutants
  and heredity; no answer for a mutant that gains a need its species lacks;
  the criterion ran headless only, never with an idle player and far-floor
  replay (P up to 64, `core/turns/round.ts`); no seeds or census in the
  gate; breed ignored crowded neighbourhoods and partial litters.

## 2. User decisions

1. **Archetypes plus generated variation.** Hand-authored archetypes fill
   each niche: body plan, behaviour set (which needs and components),
   glyph and name stem. Rat and stoat are the first two. The world seed
   picks archetypes per niche and draws a genome within each archetype's
   bounds: per-world species variants. One Catalogue per world, built at
   `createGame`, rebuilt from the saved seed by `loadGame`; the
   Fingerprint refuses divergence. Each species spans about two strata,
   so knowledge carries across floors. The archetype backbone carries
   knowledge across runs. Prior art: NetHack (random appearances over
   fixed item types), Caves of Qud (legendaries as variants of normal
   creatures), Cogmind (static and procedural mix).
2. **Heredity, then population evolution, are long-term goals.** Genome
   Expression is data rows `{gene, component, field, min, max}` applied by
   one pure function, so a later core birth path can apply it per
   individual. Heredity is not built now; v1 must not block it.
3. **Niches first**: producers, herbivores, predators, apex. Difficulty is
   a gene Budget per niche that grows with depth (a Curve in config). One
   boosted apex per stratum is a Boss, named and announced to the player.
   Floor conditions pick which species appear and how many.
4. **Mutants are individuals.** v1 is stronger; v2 gains a need its
   species lacks. Reproduction is a need (module `reproduction`, action
   `breed`) with a parametric mating system: parents 1, 2 or 3; sexes 0 to
   3; conditions as a bitmask over a closed list of coded predicates (data
   choosing coded rules, like `diet.eats`); litter; cooldown. The plan may
   stage it, with a justification and a landing list.
5. **Long-term targets the structure must not block**: groups (packs,
   herds, coordinated hunts, group flight), actions prepared over several
   turns (ambush, nests, gestation, migration), new bricks (genes, needs,
   reproduction modes, generated producers, terrain and biomes, taming).

## 3. Success criteria

Functional:

- A game saved and loaded plays on exactly as the unbroken run.
- `loadGame` rebuilds the Catalogue from the saved seed.
- A save loaded with another seed's Catalogue is refused by the
  Fingerprint.
- The species count stays at or below `MAX_SPECIES`, checked by a test.
- RSS <= 160 MB on `bench/reference.ts`. This budget is never raised.
- `bun run verify` is green after every slice.

Perceptual:

- **P1.** A generated creature on the starter floor renders with its stem
  glyph. Its size tier shows by case (S1). Species are told apart by
  colour (S4).
- **P2.** Over seeds 1..8, `herbivore.0` differs in tier or hue for at
  least two seeds.
- **P3.** Threat contacts per 100 rounds, for a moving scripted player,
  are higher at depth 40 than at depth 0 (S5).
- **P4.** No stratum-0 predator bites for >= the player's 10 hp.
- **P5.** Forage on the player's floor is never zero for more than 50
  consecutive rounds.
- **P6.** Herbivores never exceed 4x the count placed by populate within
  400 rounds.

## 4. Decisions

### D1. Catalogue

One Catalogue per world: `catalogue(seed)` returns the species table and
the Looks. `createGame` builds it from its seed. `loadGame` rebuilds it
from the seed in the save header. The species enter the Fingerprint, so a
save loaded with any other table is refused.

The Catalogue is not stored in the save. A change to the generator
therefore breaks every save. No world is persisted yet, so this is
accepted. The first persisted world stores the Catalogue and bumps
`FORMAT_VERSION` (`docs/ideas.md`).

The core gains one load seam: `loadWorld` accepts `species` as a table or
as a `(seed) => table` supplier. The supplier runs after the header is
read and before the engine is built. The core still knows nothing of the
Catalogue.

### D2. Archetypes

An Archetype is hand-authored per niche: a body (a full species with its
components), a stem and gene bounds. The behaviour set is the components
the body holds: a body without `wary` never flees. The glyph lives in the
web theme, keyed by stem: the engine sends no glyph. Rat is the first
herbivore archetype, stoat the first predator. Archetype choice per niche
arrives with the second archetype of a niche; until then the niche table
maps a niche to its only archetype.

### D3. Genome, Expression and keyed draws

- A Gene is a named integer 0..`GENE_MAX` (255). A Genome maps genes to
  values. S1 has one gene: `size`.
- Expression is a list of rows `{gene, component, field, min, max}`. One
  pure function, `express(genome, rows, body)`, returns a new species:
  `value = min + floor(gene * (max - min) / GENE_MAX)`. `min > max`
  expresses inversely. A row whose component the body lacks is skipped:
  Expression never adds a component. A row on a field the body holds as a
  Range throws. Later rows overwrite earlier ones.
- Rows are config, the formula is code. Rows are typed against the game's
  components, so a misspelled component or field fails the typecheck.
- Each gene is drawn by name, never by position:
  `draw(seed, hashName("catalogue"), PHASE.spawn, 0, SUBJECT.entity,
  hashName(name), hashName(gene))`. Adding a gene or a species re-rolls no
  other value. The S1 draw is uniform within the archetype bounds; S4
  replaces it with the Budget split.

### D4. Names

A generated species is named `${niche}.${k}`, k its stratum. The name is
a stable key for saves, tests and the species index. Display names grow
from the stem later (epithets, `docs/ideas.md`).

### D5. Look

The Look of a species is what the player sees: `{stem, tier}`, then
`{stem, tier, hue}` in S4. `tier` counts the `tiers` thresholds at or
below `vitality.max` (0 for a species without vitality). The web draws the
stem's glyph, upper-cased when `tier > 0`. A fixed species' stem is its
own name. The snapshot sends the Looks of exactly the species it lists.

### D6. Niche and Rank

Two axes, decided before the food web. Niche is the trophic place:
producer, herbivore, predator, apex. Rank is the standing of a species or
individual: normal, boss; later mutant, tamed. A boss is an apex with the
boss Rank, not a fifth niche. Rank lands in N3 with bosses.

### D7. Prey kinds

Food classes are prey kinds within the 8 bits of `diet.eats` and
`edible.class`: forage 1, meat 2, then hunter 4 in N3. Hunger matches
class bits only (`modules/hunger/index.ts`), and fear flees any eater of
its class. So no species eats its own class: herbivores are meat,
predators eat meat and are hunter, apex eats hunter. No unintended
cannibalism.

### D8. Bites and counterplay

Every gene states what the player can do about it:

| Gene | Expresses | Player counterplay |
|---|---|---|
| size | hp, bite, nutrition | the tier is visible; stratum-0 bites stay below the player's 10 hp |
| fecundity | litter, rest | starve breeders: `fed` is a breed condition |
| budget | more points deeper | depth is chosen; Looks change with it |
| speed | not built | blocked by fear `MARGIN`: one-turn actions only (`docs/ideas.md`) |

A bite goes through `harm`: it wounds, it does not kill outright. Speed is
the first fear-rule change any later gene needs.

### D9. Reproduction staging

Reproduction is a need: module `reproduction`, action `breed`. S3 builds
budding: one parent, conditions as a bitmask over coded predicates (`fed`,
`uncrowded`), litter, cooldown. `breed` picks free cells around the
parent. A crowded neighbourhood gives a partial or empty litter, and the
cooldown still applies. A core `WriteCtx.spawnKin(parent, x, y, cause)`
spawns the parent's species.

Budding comes first because it needs no kin perception and proves the
need, the litter and the population bounds alone. Landing list:

- S3: budding, `fed` and `uncrowded`, litter, cooldown.
- After the v1 gate: pairs and sexes through a `ReadCtx.kin` view, then
  more predicates (season, territory).
- With multi-turn plans: gestation and nests.
- Trios and sexes above 2: when a third archetype asks for them.

### D10. Strata and Budget

A stratum is `stratumFloors` (4) floors deep; 16 strata. Each generated
niche gets one species per stratum. Each species spans about two strata,
so neighbouring floors share species. The Budget is a Curve per niche over
depth: the points a genome spends on its genes.

Species count: 3 generated niches x 16 strata + 16 bosses + 7 fixed = 71,
well under `MAX_SPECIES`. Producers stay hand-written. A test pins the
count against the limit.

### D11. Floors

`world/populate` fills a floor by depth: which species, and how many. It
keeps a safe radius around the start and arrival cells. It keeps a forage
floor so herbivores cannot strip the player's floor (P5). It bounds
herbivores (P6). The threat metric counts predator contacts with a moving
scripted player per 100 rounds (P3).

### D12. Mutants and heredity: the core path

Today every individual of a species shares its expressed values, apart
from Range draws. A mutant or an heir needs values per individual. The
core change, built in N4:

- `DeferredSpawns` carries a values payload, so a birth can set fields.
- Expression runs per individual at birth: `express` moves to the core
  lifecycle as one compiled step.
- Drawn vitality passes the health check (`checkHealth`), as a species
  does today. A Range on vitality stays refused: a drawn hp would escape
  the check.
- A per-entity genome column is saved, so heirs and loads keep it.

A v2 mutant gains a need its species lacks. Expression never adds a
component, so the species must hold the component already, inert, and the
gene turns it on. N5 settles this.

### D13. Remains and events

Death becomes a core sequence: kill, drop, remains, remove. Remains are a
carcass: food that persists, paired with bites through `harm`. The client
receives `ate`, `died` and `born` events with their cause. This lands in
N1, before the v1 gate, because the simulation is otherwise invisible.

### D14. RSS, pins and review

RSS stays <= 160 MB on `bench/reference.ts`; the budget is never raised.
Every pinned hash is re-pinned only on purpose, named in the commit body.
Every slice gets the `reviewer` agent and a Codex review
(`codex review --uncommitted`). High-risk slices also get a red team.

## 5. Target structure

```
content/catalogue/
  types.ts           Archetype, GeneRange, Look, Gene
  expression.ts      GENE_MAX, ExpressionRow, express()
  genome.ts          drawGenome(): keyed draws, then the Budget split (S4)
  config.ts          expression rows, tiers, budgets, hues
  index.ts           catalogue(seed) -> {species, looks}
  archetypes/        one file per archetype; index.ts maps niche -> archetype
modules/reproduction/  breed, litter, cooldown, coded predicates (S3)
modules/hunger/        bite through harm (S2)
world/populate.ts      floor population by depth (S5)
world/config.ts        counts, safe radius, forage floor (S5)
core/world/world.ts    species table or (seed) => table supplier
packages/protocol      Look; Snapshot.looks
apps/server            session sends the looks of listed species
apps/web               glyph by stem, case by tier, tint by hue
```

Flow: seed -> `catalogue(seed)` -> `createGame` -> populate -> snapshot
with looks -> web glyph and tint. `loadGame` reads the seed from the save
and calls `catalogue` again.

## 6. Extension map

- **Groups.** A `pack` module with a leader column. A membership contract
  once fear reads it (group flight). Coordinated hunts are candidates
  scored from the membership view, never a group-level decision.
- **Multi-turn plans.** A module owns progress columns and proposes a
  goal candidate with inertia. No core multi-turn intent. Ambush, nests,
  gestation and migration follow this pattern.
- **Core views later.** `ReadCtx.kin` (same-species neighbours) for pairs,
  herds and packs; a `ReadCtx` clock for seasons and gestation.
- **Heredity.** D12's core path, then a parent genome mixed at birth.
  Population evolution follows from heredity and selection; no extra
  system.
- **New bricks.** A new gene is a `Gene` name plus expression rows. A new
  archetype is one file under `archetypes/`. Archetype pick per niche lands
  with the second archetype of a niche. Generated producers, terrain and
  biomes, taming: new archetypes, modules or Ranks, never a parallel
  decision system.

## 7. Not built

Heredity and population evolution; pairs, trios and sexes; gestation;
groups; generated producers; a speed or metabolism gene; display-name
epithets; the Catalogue stored in the save; taming; per-individual
Expression before N4.

## 8. Slices

Each slice: behaviour + data + seeded test, about 150 lines of diff,
`bun run verify` green, review per D14.

This run:

1. **S1 Walking skeleton.** This doc and the glossary. `content/catalogue`
   with the rat archetype, Expression rows on `size`, keyed draws,
   `catalogue(seed)` with `herbivore.0`. The core load supplier,
   `createGame` / `loadGame` wiring, two `herbivore.0` on the starter
   floor, `Snapshot.looks`, glyph by stem and case by tier. Tests: same
   seed same Catalogue; `vitality.max` varies over seeds; save/load equals
   an unbroken run; another seed's table is refused by the Fingerprint.
2. **S2 Predation.** Stoat archetype, bites through `harm`, size drives
   bite and nutrition. P4 holds.
3. **S3 Reproduction.** `WriteCtx.spawnKin`, module `reproduction` with
   budding (D9), a crowded-neighbourhood test and partial litters.
4. **S4 Strata.** One species per niche per stratum, the Budget split
   replacing the uniform draw, hue in the Look, the species-count test.
   P2 holds.
5. **S5 Floor population.** Depth ranges, populate by floor conditions,
   safe radius, forage floor and herbivore bound, the threat metric. P3,
   P5 and P6 hold.

Next run:

1. **N1 Events and Remains.** The death sequence (D13) and events with
   their cause in the snapshot.
2. **N2 Dungeon on the server.** The session runs a populated dungeon and
   sends the player's current floor.
3. **N3 Apex, Rank, bosses and the v1 gate.** Prey kind hunter, Rank,
   one announced boss per stratum. Gate: seeds 1..3, 11 floors, 1000
   rounds, census per stratum excluding bosses, run headless and with an
   idle player (far floors replay up to P=64).
4. **N4 Mutants v1.** Stronger individuals through D12's per-individual
   Expression, values payload and health check.
5. **N5 Mutants v2.** An individual gains a need its species lacks.
