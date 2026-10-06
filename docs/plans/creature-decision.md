# Plan: creature decision foundation (v2, after red/blue review)

Inputs: a map of the core after the layout refactor (c0a8774); two
independent Opus designs (game-AI architect, computational ethologist); an
`advisor` review with prior art (Lewis, *Choosing Effective Utility-Based
Considerations*, Game AI Pro 3; Dill, *Dual-Utility Reasoning*, Game AI
Pro 2; Graham, *An Introduction to Utility Theory*, Game AI Pro); a
gpt-5.5 review; a red-team and a blue-team review of v1.

User decisions:
- Creatures should read as real animals: credible, organic, individual.
- Personality is a set of independent trait axes, not a triangle (axes do
  not trade off; Sih et al. 2004). Axes live at species level (a range),
  individual level (drawn at birth) and later evolve with experience.
- Dozens of behaviours per creature must not become a rigid if-chain.
- The whole abyss stays alive and fast, not only the player's floor.
- Milestone 1 proves one thing: individuals visibly differ. Shy, average
  and bold rats react differently to the same stoat.

## 1. Success criteria

All measured on seeded headless runs or `bun bench/reference.ts` (one row
per budget; FAIL rows do not change the exit code, so read them):

- Forced shy (boldness 0) and bold (255) rats facing the same stoat: the
  shy rat starts fleeing at distance 3, the bold one at distance 1.
- One seed, 200 rats drawn from species defaults, each alone at distance
  3 from a stoat: the outcomes include both `flee` and `watch`.
- The flight distance never increases with boldness.
- Intent reversals (A→B→A within two decisions) on two seeded floors do
  not exceed their pinned counts (oscillation guard). `watch` adds alert
  episodes, so the raw switch count was re-baselined (44/48 → 51/59) and
  is not the oscillation measure: reversals with traits stay within two of
  the count without traits (13/29 with, 24/27 without).
- A wary rat caching `eat` on a P=64 floor re-decides on the turn an
  alarm reaches its cell; a stoat never re-decides because of it.
- Bench, paired: each perf-sensitive slice is benched right after its
  base, under the same machine load. Cached actor turn at P=64 and world
  round within +5% of the base (slices 2 and 6: see D6); player floor within +10%; RSS <= 160 MB.
  Absolute budgets are re-checked on an idle machine: on 2026-10-06 a
  loaded machine (load average ~3.8) measured 96-100 ms rounds and
  180-186 ns cached turns on both `c0a8774` and `e50a6d8`.
- The game runs with `temperament`, `fear` or `hunger` removed. The golden
  hash is re-pinned only on purpose, with the reason in the commit.

## 2. Decisions

### D1. The core supplies scoring tools, not a behaviour engine

`core/decision/` (it already holds `arbitration.ts` and `perception.ts`)
gains `bands.ts` and `curve.ts`, exported through `core/module/api.ts`.
The core still only takes the argmax of pushed candidates. A behaviour
stays code inside its module. A new behaviour gets its own file under
`modules/<mechanic>/behaviours/`; existing ones move there only when their
module file needs the split. No `Behaviour` object, no declarative
behaviour data: conditions stay in code; only numbers are data.

This reverses the "shared response-curve helper" line of
`docs/plans/ecs-core.md` section 3.

### D2. Priority bands

The score order is a convention in comments today. It becomes core data in
`core/config.ts`, on today's scale, so every current score keeps its value:

| Band | Scores | Members today |
|---|---|---|
| reflex | 900-1000 | flee (1000), avoid fire (900) |
| urgent | 100-899 | eat (100-300) |
| vigilance | 60-99 | watch (new) |
| routine | 1-59 | explore (50), wander (10) |

`band(name, weight)` maps a weight 0..255 into the band; weight 0 means no
candidate. A seeded-world test fails if a game module pushes a score
outside every band. Core tests that push synthetic scores are not
concerned. `INERTIA` stays flat; per-band inertia is added only if the
oscillation guard fails. `band()` maps a weight into `[min, max -
INERTIA]` for every band but the top, so inertia never lifts a cached
candidate into the next band. Bands are rescaled only when a measurement shows
a band lacks resolution.

### D3. Curves

A curve is a list of `[input, output]` points, inputs and outputs 0..255,
linear between points. `curve(points)` compiles it into a 256-entry
integer table; a module calls it in `setup`, so it is built once per
world. Integer interpolation rounds down. Its limits (255, 256) are named
constants: Biome forbids magic numbers in the engine. A behaviour combines
factors in code (`min()`, comparisons); no generic combiner.

### D4. Individual traits

- A species field may declare a range `{ min, max }` instead of an
  integer. Both bounds fit the column, `min <= max`, and the width is
  below `MAX_BOUND` (65536). A core field (`vitality`, `link`) takes no
  range: a drawn value would skip the health and link checks. The range
  enters the fingerprint. Spawn values stay integer-only.
- `place()` (`core/lifecycle/lifecycle.ts`) draws each range per entity:
  the sum of two bounded draws, halved; an odd sum rounds on a spare bit
  of the second draw, so the mean sits at the midpoint. The draws are keyed
  by seed, owner module name, `PHASE.spawn`, entity id and the field's
  name hash, never its position; the time argument (0, then 1) tells the
  two draws apart: adding or reordering schema fields
  re-rolls nothing. A field given in `spawn(..., values)` is not drawn.
  The no-range path does no work.
- Only `spawn` and deferred spawns call `place()`. Load and arrival
  restore stored columns and never draw again.
- `modules/temperament/` owns `temperament: { boldness: u8 }`, data only:
  no propose, no action, no tick, no `config.ts`. More axes arrive as
  fields when a rule reads them. The `temperament` contract arrives in
  slice 5 with fear, its first reader, as every existing contract did.
- Rat boldness 20-140, stoat 120-240 (`content/species/`).
- Evolution with experience is out of scope. It will be temperament's own
  tick reading contracts, never events.

### D5. Fear uses traits and state

Fear scans for the nearest perceived eater of its class (today it takes
the first), behind the existing danger pre-check. Its flight distance:

```
flight = curve([[64, 3], [192, 1]])[boldness] // 3 for shy .. 1 for bold
flight -= satiety < cfg.riskBelow ? 1 : 0   // a hungry animal risks more
flight += fleeing ? 1 : 0                   // hysteresis
flight = clamp(flight, cfg.flightMin, PERCEPTION_RADIUS)
```

- `d <= flight`: `flee` in the reflex band, as today.
- `flight < d <= PERCEPTION_RADIUS`: new `watch` in the vigilance band. It
  idles with the threat as target. It fails when the threat leaves
  perception, when any perceived eater of its class comes within the
  flight distance, or when the actor is starving (below `riskBelow`); a
  starving creature never proposes it. The actor then decides again. A sated rat watches; a hungry one keeps eating.
- Hysteresis: fear owns `fleeing: u8` on `wary`. The flee action sets it;
  fear's tick clears it on rows whose cell carried no danger of the row's
  class last round. The clear shares the prey loop that runs before this
  round's stamp, so calming lags one round.
- Without `temperament`, flight is `PERCEPTION_RADIUS`: fear flees on
  sight, as today. Without `hunger`, the satiety term is skipped.
- `avoid` (fire) keeps its own `danger.fire` gate and is unchanged.

### D6. Alarms keep far floors reactive

A module declares one of its own u8 cell fields as an alarm for actors
with given components: `b.alarm(field, ["wary"])`. Before replaying a
cached intent, `decide()` (`core/turns/turn.ts`) checks the actor's
component mask, then reads the field at its cell; nonzero skips the replay
and runs a full decision. Zero alarms cost nothing measurable.

The alarm is edge-triggered over a radius. Fear stamps `spotted.eats` on
cells within `alarmRadius` of an eater (fear config, default
`PERCEPTION_RADIUS + MARGIN` = 4) and sets `alarm.eats = spotted.eats &
~previous spotted.eats`: a cell alarms only on the turn an eater first
comes that close. An alarm stays silent for an actor whose cached intent
is an action of the alarm's own module: those actions revalidate the
alarm's condition on every replay (`.claude/rules/engine-modules.md`).
`b.alarm(table, field, requires)` names an own u8 cell field. Stoats lack
`wary` and never pay.

History of the decision, all measured paired on a loaded machine:
- Level-triggered over reach 4: world round +190%.
- Edge over reach 4 (slice 2): +12%, accepted. A final review found the
  wake fires beyond sight and sees nothing, so a far rat replaying `eat`
  could be eaten without reacting.
- Level over sight with own-module silence: correct reflexes, +103%;
  with perf B and C1, +48%; edge over sight with B and C1: +28%. The cost
  is far-floor rats actually reacting (several times more flee and watch
  replays), not the alarm itself.
- The user chose cheap far floors: edge over radius 4 with B and C1,
  world round +0.4% versus slice 5, player floor -10%. `alarmRadius` 3
  makes far floors reactive (about +28%): a config change, no code.

Accepted limits on far floors: an actor that keeps eating as an eater
closes in, or walks into standing danger, keeps its cache until its next
scheduled decision; a wake at radius 4 usually sees no eater yet.

Perf B and C1, behaviour-neutral (50 columns hashed every round for 40
reference rounds, identical): fear finds eaters through its own `reach`
stamp (eaters within `MARGIN` at the tick) in `sight.ts`, and flee
geometry lives in `escape.ts`, so flee and watch revalidate without a
perception fill. Perception keeps its last fill while floor, actor and
`Grid.version` are unchanged. B assumes every action costs one turn; a
test pins it. An eater spawned mid-round outside every stamp stays unseen
until the next tick; no current module spawns one.

### D7. Tree

```
core/decision/{arbitration,perception,bands,curve}.ts
core/module/api.ts              exports band, curve, b.alarm
modules/temperament/{index,schema}.ts
modules/fear/{index,schema,config,sight,escape}.ts
modules/fear/behaviours/watch.ts
contracts/index.ts               + temperament (slice 5)
content/species/{rat,stoat}.ts   + boldness ranges
```

CLAUDE.md "Where code goes" gains a row: one behaviour of a mechanic →
`modules/<mechanic>/behaviours/<behaviour>.ts`. CONTEXT.md gains Band,
Alarm, Curve, Trait, Temperament and Flight distance, each in the slice
that introduces it.

## 3. Not built

Groups and sociability; environment use; multi-turn strategy; evolution
with experience; heredity; more trait axes; per-band inertia; a curve
shape palette or generic combiner; moving existing behaviours into
`behaviours/`; a wider perception radius; masking proposers by
components (its entry cost is measured in slice 2); traits in the protocol
or the web.

## 4. Slices

Each slice: behaviour + data + seeded test, `bun run verify` green, bench
rows read, then a red-team and a blue-team review before the next slice.
Every change to `core/module/api.ts` is a deliberate commit that updates
`test/core/module/api-surface.types.ts` and `api.test.ts`. All repo
content in English. Target ~150 lines of diff per slice.

1. **Priority bands.** The band table in `core/config.ts`. Modules and
   their configs stay untouched: configs enter the fingerprint, and
   hunger's scores (100, 120 … 300) are not reachable from a 0..255
   weight. `band()` arrives in slice 5 with `watch`, its first user.
   Tests: on a seeded 300-round world, each action's pushes lie in its
   expected band; golden hash unchanged.
   Helper: intent switches per entity, first decision excluded
   (`test/fixtures.ts`); baselines pinned as upper bounds on two seeds.
2. **Alarms.** `b.alarm(field, requires)`, the check in `decide()`, fear's
   edge stamp `alarm.eats` and its cell table split (revised in slice 6).
   Tests: a wary rat caching `eat` on a P=64 floor re-decides the turn an
   alarm reaches its cell, and not before; a stoat on an alarmed cell
   keeps replaying; hash identical across floor-order permutations.
   Bench: all rows before and after, recorded in this file; the proposer
   entry cost measured and recorded.
3. **Ranges drawn at birth.** Range values in species types, compile,
   canonical form and `place()`.
   Tests (`test/core/lifecycle/`): 1000 draws stay in range, centre near
   the middle, both ends reached; same seed, same values; an extra
   registered module shifts no value; an explicit spawn value wins and
   shifts no other draw; save/load and travel keep values (reuse the
   persistence and travel test patterns).
4. **Temperament.** `modules/temperament/` (index, schema), rat and stoat
   ranges, registry entry. No contract yet (slice 5).
   Tests: boldness differs between rats of one seed; the game runs
   without temperament.
5. **Fear reads traits.** The `temperament` contract;
   `core/decision/{bands,curve}.ts` with `band()` and `curve()` exported;
   the flight
   curve, nearest-threat scan, satiety shift, `fleeing` hysteresis,
   `fear/behaviours/watch.ts`.
   Tests: forced shy and bold rats flee at 3 and 1; a sated average rat
   watches at 3 then flees at 2; a starving bold rat keeps eating at 2;
   200 rats at distance 3 give both flee and watch; flight distance
   non-increasing in boldness; the nearest eater wins; a watch fails when
   a second eater comes within flight; intent reversals within their
   pinned counts; without temperament, today's fear tests pass unchanged.
   Bench rows recorded.

6. **Final review fixes.** Edge alarm over `alarmRadius`; own-module
   alarm silence; `b.alarm` by names; perf B and C1; bands capped at
   `max - INERTIA` below the top; `watch` fails and is not proposed when
   starving; flight readers chosen once at setup; one `SpawnValues` type.
   Tests: each fix has a seeded test; the accepted limits are pinned by
   tests; the one-turn action cost is pinned.

## 5. Closing

Milestone 1 holds: shy, average and bold rats react differently to the
same stoat (flee at 3, watch then flee at 2, flee at 1), hunger shifts
the risk, and reversals stay within two of the count without traits.

The structure for more behaviours is in place: priority bands as core
data, curves compiled from data, one file per new behaviour, traits drawn
per individual from species ranges, and module alarms.

Measured on a loaded machine (load average 3-8), paired with the previous
slice: world round +0.4%, player floor -10%, P=64 actor turn unchanged,
RSS unchanged within noise. Absolute budgets still need an idle machine:
both the base and this branch read about 111 ms rounds and 210 ns cached
turns under load.

Deviations from v2: bands kept today's scale and arrived without module
changes; the contract arrived with its first reader; the alarm went
through four designs (D6); fear gained perf B and C1; the switch guard
became a reversal guard.

Follow-ups in `docs/ideas.md`: class-aware alarms. Next candidates for
this structure: sociability (groups), environment use, evolution of traits
with experience.
