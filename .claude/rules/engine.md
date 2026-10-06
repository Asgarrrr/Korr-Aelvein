---
paths: ["packages/engine/**"]
---

# Engine guide

Read with `CLAUDE.md` (binding rules) and `docs/plans/ecs-core.md` (design
D1–D13, budgets, closing state §4b). This file holds what neither states and
the code does not show cheaply. Module authors: also `engine-modules.md`.

Terms: a *slot* is an index into the columns. A *row* is the values at one
slot across all columns. An `EntityId` names an entity for life.

## Mental model

- A world has up to `MAX_FLOORS` floors. A floor owns its slots, ids, grid,
  scheduler, events, inbox and cell slices (D3). Floor order never changes
  a result: `WorldOptions.floorOrder` exists to test that.
- A round is lockstep. Every floor runs `beginFloor` (inbox arrivals, then
  each tick in registry order), then `runActors` (`core/turns/turn.ts`).
  Harm, kills and spawns land after each tick and each actor turn.
- Convert ids and slots with `ctx.slotOf` / `ctx.idOf` inside a callback.
  `slotOf` returns `NONE` for an id that is dead, in transit or elsewhere.
- Intent: the chosen (action key, target) is cached in core columns. With
  period P > 1, an actor re-executes its intent unless
  `(round + id) % P == 0` (`decide` in `turn.ts`). P comes from
  `LOD_PERIODS` by floor distance to the nearest player, fixed at round
  start (`startRound` in `core/turns/round.ts`). No player anywhere: P = 1.
- FAIL means "this decision is invalid". A FAIL on a cached intent clears
  it and arbitrates in the same turn. A FAIL on a fresh choice clears the
  intent and costs the turn. A step that is only blocked must reach
  `ctx.idle` through `ctx.instead`: the intent survives (D8).
- Scores must be integers (else `out.push` throws). They clamp to
  `[0, SCORE_MAX]`. Then a candidate that matches the intent gets
  `+INERTIA`, so it can reach `SCORE_MAX + INERTIA`. Ties go to the lower
  action key hash, then target kind, then target. Divide before multiply.
- Harm drain (`core/health/harm.ts`): sorted by (target, cause, amount)
  and summed per target. At `hp <= 0` the lowest cause kills. After each
  callback: harm, then deferred kills by (cause, id), then deferred spawns
  by (cause, cell) (`applyDeferred` in `core/lifecycle/lifecycle.ts`).
- Deferred spawns act at `now + TICKS_PER_TURN`. A deferred spawn past
  `popCap`, or an actor spawn onto an actor's cell, is dropped silently.
  `world.spawn` throws in both cases.
- Events are facts for the server (`World.drainEvents`). Names are
  `module/name`. The core emits `core/died`, `core/spawned`,
  `core/departed`, `core/arrived`. `EVENT_CAP_PER_TURN` is per floor per
  round, and it counts emissions with events off too.
- `b.previous` is last round's copy of a cell field, taken before the
  owner's tick. It is never saved; only that tick may read it.
- Players are actors with the `PLAYER` mask bit. `World.advance()` runs
  until players are due and returns them. `World.input(player,
  "module/action", target)` plays one turn. An unknown name or invalid
  target is recorded in `inputs()` as `core/idle` with a null target, and
  played as idle. `runRounds` throws once a player is due.
- A throw while a round or a player turn runs poisons the `World`: every
  later call throws. `input` for a player that is not due throws without
  poisoning (`core/game-world.ts`).
- Travel: `core.travel` posts the row to the destination inbox at
  `time + STAIR_TIME`. Position, schedule and intent are not carried. The
  mask and every other saved column are (`Engine.carried`). Cell columns
  never travel.

## Where to look in `core/`

| Path | Holds |
|---|---|
| `api.ts` | The only engine surface a module sees. Frozen. |
| `world.ts`, `game-world.ts` | `World` API (not yet exported: `src/index.ts` is empty); call guards. |
| `engine.ts` | All engine state; registers `core/step`, `core/idle`, `core/travel`. |
| `setup/registration.ts` | Ownership checks, `ModuleBuilder`, fingerprint, carried columns. |
| `turns/turn.ts` | Tick phase, actor loop, `decide`, `execute` (`requires`, alternates), `step` body. |
| `turns/round.ts` | `advance`, LOD periods, player turns. |
| `turns/target.ts` | `validTarget`: one rule for proposals, alternates, inputs and loads. |
| `turns/arbitration.ts` | Candidate buffer: score checks, inertia, tie-break. |
| `turns/context.ts` | The ctx object; phase guards (`instead`, writes in propose). |
| `travel/` | `core.travel` body, departure, inbox, arrival on a free cell. |
| `space/` | Grid lists, perception fill order, `approach`, cell readers and writers. |
| `events/` | Per-floor event ring and its cap. |
| `random/` | Keyed `draw` and bounded ints (D6). |
| `health/` | `coreSchema` (vitality, link) and the harm drain. |
| `ecs/` | Storage, masks, queries, getter views; imports nothing else from core. |
| `lifecycle/` | Spawn by name or shape, `values`, kill, deferred lists. |
| `persistence/image.ts` | Floor image layout, `FORMAT_VERSION`, `sectionsOf`, checksum. |
| `persistence/validate.ts`, `rows.ts` | Load checks, fast and full. |
| `audit/` | Audit mode: column diffs around callbacks, range-checked writes. |

## Recipes

### Add a mechanic module

Follow `engine-modules.md`, then:

1. Register it in `registry.ts`. Position decides tick order, the order of
   tick events, and the fingerprint. It never decides ties or RNG draws.
   Tick after every module whose cells or rows your tick reads this round.
   The golden hash moves (see Gotchas).
2. Add its species components in `content/species/`.
3. Tests in `test/modules/<name>/` (rules: `CLAUDE.md` § Testing): a
   seeded behaviour test; the tick under `reversed()` from
   `test/fixtures.ts` gives the same hash; the same hash with
   `audit: true`. Any pre-check gets a differential test (see Gotchas).

### Add a species

Add a file typed `satisfies GameSpecies` and list it in
`content/species/index.ts`. Only a non-actor may have a link. Vitality
needs `0 < hp <= max <= I16_MAX`. The table joins the fingerprint.

### Spawn in world generation

Call `world.spawn(floor, "rat", x, y, values?)`. A name uses the species
compiled at build; a shape compiles on every call. `values` get the field
checks of a species shape (kind, health rule, link rule). A registered
component the species lacks throws; an unregistered one is skipped. The
engine keeps no `values` object. Stairs: `"stairs"` with `values.link`.
`bench/reference/world.ts` switches events off while it generates.

### Change the frozen core API

Only on purpose, in one commit that says why. Edit `core/api.ts`. Then
update the pins: `test/core/api-surface.types.ts` and the export list in
`test/core/api.test.ts`. A new `ReadCtx`/`WriteCtx` member also goes into
`backwards()` in `test/fixtures.ts`. A new `Builder` member goes into every
`Builder<S, K>` literal: `reversed()` in `test/fixtures.ts`,
`danger.test.ts`, `explore.test.ts`, `timed()` in `bench/reference/run.ts`,
and `bench/slice4.ts`. The typecheck lists them.

### Change the save format

- The fingerprint holds module schemas, cells, configs, registry order and
  the species table. A mismatch already refuses the load: no version bump.
- Bump `FORMAT_VERSION` in `persistence/image.ts` when the layout changes
  outside the fingerprint. Examples: header words, section order, inbox
  entries, a core column outside `coreSchema`.
- A new core column outside `coreSchema` needs a label in the `Audit`
  constructor. Else the audit throws "a saved column has no owner".
- Every new core column needs load checks in `validate.ts` or `rows.ts`.
- If it must not travel, add it to the `local` set in `registration.ts`.
- If header words move, update the word map in
  `test/core/persistence/save.test.ts`.

## Gotchas

- Golden hash (`test/core/persistence/hash.test.ts`): it folds
  `FORMAT_VERSION` and the fingerprint. Registry, config, schema or
  species-table edits move it with no behaviour change. A refactor must
  keep it. Re-pin only when the result is meant to change; say so in the
  commit body.
- `createWorld` with the game registry but no `species` table throws in
  setup ("flora spawns mushroom…"). Tests spread `game` from
  `test/fixtures.ts`.
- Config holds integers and name strings only. A boolean or float throws
  when the world is built (`setup/canonical.ts`).
- `Query.slots(ctx)` fills one list shared by all calls. Never nest two
  loops over the same query.
- A slot is valid only in the current callback. Store `EntityId`s
  (`entity` field kind), never slots.
- A cell target is floor-local, so arrival clears the intent. Never carry
  a cell index in an entity column across travel.
- `ctx.rng(subject, n, bound)`: `n` is the draw index. Reusing it repeats
  the value, also across an `instead` chain.
- These throw: an action cost that is not an integer >= 1, `ALTERNATE`
  without `ctx.instead`, a chain past `MAX_ALTERNATES`, more than
  `MAX_CANDIDATES` pushes.
- A pre-check that skips a scan (fear's `danger`, explore's `exits`) must
  mark a superset of what the scan finds, with slack for movement (`MARGIN`
  in `modules/fear`). Prove it: forcing the pre-check true changes no
  outcome (`danger.test.ts`, `explore.test.ts`). Pin its known limit.
- Per-call allocation in a hot path shows as RSS, not time. An 8-element
  array per flee cost 60–100 MB. Read into locals instead.
- `ctx.kill` is deferred: the victim stays visible until the callback ends.
- `b.read` returns `undefined` when the owner is not registered. `b.query`
  and `requires` throw on such names: guard them as `fear` does.
- Audit mode (`audit: true`, tests only) catches writes to non-owned
  columns, other floors, free slots, any write in propose, out-of-range
  writes, and writes to an owned component the row lacks. It misses state
  kept in `setup`, wrong in-range values and order dependence.
- Loads (`LoadOptions.check`): `"full"` is the default. `"fast"` trusts
  the checksum for row contents, so use it only on images this server wrote
  and kept. It still refuses duplicate ids, actors due outside
  `[now, MAX_TICK]`, and slots, cells and links off the floor. On
  `loadWorld` it skips the cross-floor id check.
- Undrained events are overwritten oldest first once a ring holds
  `EVENT_CAP_PER_TURN`. The server must drain every floor every round.
- Save points: `save()` works while floors are paused on a player.
  `loadFloor` needs an image saved at a round boundary, and only while the
  floor's traffic hash matches the live floor.
- `saveFloor(floor, into)` returns a view of `into`: the next save overwrites it.
- A full floor keeps arrivals in its inbox. `locate` can then report
  `"transit"` past `STAIR_TIME`.

## Verification

- Commands: `CLAUDE.md` § Commands. Mutation habit:
  `~/.claude/rules/verification.md`.
- `bun run bench` from `packages/engine` runs every slice bench and the
  reference. `bun bench/reference.ts` prints one row per section 1 budget.
- PASS means the median is within budget on this machine. The world round
  row also bounds p95. The plan set budgets on an M5 Pro.
- It throws if a rerun or a permuted floor order changes the hash. Its
  exit code ignores budget FAIL rows: read them.
- Determinism tests to reuse: `reversed()` ticks, `floorOrder`
  permutations, events on and off (`core/events/events.test.ts`), save
  plus load mid-run equals an unbroken run, audit on and off.
