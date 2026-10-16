# Korr Aelvein — domain language

One name per concept. Code, comments, docs and commit messages use these
words with these meanings. A new concept gets an entry here before it gets
a second name anywhere.

## World and time

- **World**: every floor of one game, its seed and its round counter.
  Code: `World` (`packages/engine/src/core/world/world.ts`).
- **Floor**: one dungeon level. It owns its slots, ids, grid, scheduler,
  events, inbox and its slice of every cell column.
- **Round**: one lockstep turn of every floor, `TICKS_PER_TURN` ticks long.
  Each floor runs its phases in order: inbox arrivals, then ticks, then
  actors, then deferred changes.
- **Tick** (time): the integer unit of time. `nextAt` and costs count ticks.
- **Tick** (phase): a module's bulk pass over a floor, once per round. The
  context always tells which of the two meanings applies.
- **Turn**: one actor's decision and action.

## Entities and storage

- **Entity**: anything on a floor: a creature, an item, stairs.
- **EntityId**: an entity's name for life, `originFloor * 2^25 + counter`.
  Never reused, kept across floors.
- **Slot**: an index into the columns. Valid only inside the current core
  callback; never stored.
- **Row**: the values at one slot across all columns.
- **Component**: a named group of fields a module owns, such as `satiety`.
- **Column**: one typed array holding one field for every slot.
- **Cell column**: one typed array holding one field for every cell of
  every floor.
- **Sparse component**: a component a module lists in `sparse`. Its
  fields live in the floor's pool rows, not in a column per slot. Only
  non-actors hold one for now.
- **Pool row**: the row of a sparse component's values for one entity, in
  its floor's pool (`SparsePool`, `core/ecs/sparse.ts`). Resolve it with
  `row(slot)` in each callback: an applied kill moves the floor's last
  pool row into the freed one.
- **Species**: which components an entity starts with, and their values.
  Content data, compiled once per world. Each entity saves its species as
  an index into the world's sorted species names; 0 means unnamed (spawned
  from a shape, tests only), and `entities` refuses unnamed entities.
  A field may hold a range `{ min, max }`. Each entity draws its own value
  from the range at birth: triangular and deterministic. A spawn value
  overrides the draw. Core fields take no range.
- **Range**: the `{ min, max }` of a species field, the bounds of the value
  each entity draws at birth. A band bounds candidate scores; a range bounds
  a field value. A Trait is a field with a Range.
- **Actor**: an entity the scheduler runs. A **player** is an actor whose
  decision comes from a recorded input.

## Decisions

- **Need**: what a creature acts to satisfy. Every behaviour extends needs
  or the environment that shapes them.
- **Candidate**: a scored (action, target) a module proposes for an actor.
  The core picks one per actor.
- **Band**: a fixed range of candidate scores (`BANDS` in `core/config.ts`).
  A candidate in a higher band beats any candidate in a lower band. From
  high to low: reflex, urgent, vigilance, routine.
- **Curve**: a list of `[input, output]` points, both 0..255, linear
  between points and flat beyond the ends. `curve` compiles it once per
  World into a 256-entry integer table a Mechanic indexes by a Trait.
- **Flight distance**: the Chebyshev distance within which a wary creature
  flees a perceived eater. Farther away, still in sight, it watches.
  Boldness sets the distance through a Curve. Starving takes one cell off.
  Fleeing adds one cell.
- **Goal action**: an action whose target persists across turns (eat this
  food, flee this threat). It reaches `core.step` through `instead`.
- **Intent**: the cached (action key, target) of an actor's last decision.
  A matching candidate gets inertia; a FAIL clears it.
- **Period (P)**: how often an actor re-decides. Set per floor by distance
  to the nearest player; between decisions the actor repeats its intent.
- **Alarm**: a u8 cell field a module sets only on the turn an eater first
  comes within the module's alarm radius of a cell. An actor there with the
  alarm's required components decides in full instead of replaying its
  Intent, unless that Intent is an action of the same module. Every action
  of the declaring module revalidates the alarm's condition when it replays.
- **Requires**: the components an action needs on its actor. Without them
  the action is a FAIL.
- **Harm**: buffered health loss, applied by the core after each callback.
- **Event**: a fact for clients. Events never drive behaviour.

## Travel and persistence

- **Stairs**: an entity whose `link` names a destination floor and cell.
- **Inbox**: entities on their way to a floor, sorted by (time, id) and
  saved with that floor.
- **Floor membership**: an entity being on a floor: its slot, grid link,
  schedule entry and player count. Changed only by `attach` and `detach`.
- **Image**: one floor's saved bytes: header, sections, inbox entries,
  checksum.
- **Save**: the world header plus every floor image.
- **Fingerprint**: a hash of the core schema, each module's name, schema,
  cells and config in registry order, and the species. A save only loads
  into a world with the same fingerprint.
- **Traffic**: a per-floor running hash of the departures that leave or
  head for the floor. A single floor restores only when its traffic matches.
- **Fast / full check**: the two load tiers. Fast is for the server's own
  saves; full is the default.

## Mechanics

- **Mechanic**: one module folder (`modules/<name>/`) adding needs,
  components and systems. Removing it leaves a running game.
- **Contract**: a component or cell field read by a second module, typed
  in `contracts/` and read through a getter view.
- **Trait**: one independent personality axis of an individual, such as
  boldness. Each entity draws its value from its species Range at birth.
- **Temperament**: the module and component that hold an individual's
  Traits. It stores values only: it proposes no action and runs no tick.
- **Game**: the registry plus the species table: what the server runs.
  Code: `game` (`packages/engine/src/game.ts`). `createGame` / `loadGame`
  build a World running the Game.

## Generated species

Plan: `docs/plans/generative-species.md`. Code:
`packages/engine/src/content/catalogue/`.

- **Archetype**: a hand-authored species template for a Niche: a body, a
  stem and gene bounds. Rat is the first herbivore Archetype.
- **Catalogue**: one World's species table and Looks, built from its seed
  by `catalogue(seed)`. `createGame` builds it; `loadGame` rebuilds it
  from the saved seed.
- **Gene**: a named integer 0..`GENE_MAX` (255), such as `size`.
- **Genome**: the values of every Gene of a generated species, drawn from
  the seed within its Archetype's bounds.
- **Expression**: the data rows `{gene, component, field, min, max}` and
  the one pure function that turns a Genome into species field values.
- **Niche**: the trophic place of a species: producer, herbivore,
  predator, apex.
- **Rank** (planned): the standing of a species or individual: normal,
  boss; later mutant, tamed.
- **Look**: what the player sees of a species: its stem, its size tier,
  later its hue. Sent in the Snapshot.
- **Stratum**: a band of floors deep in the dungeon. Each generated Niche
  has one species per Stratum.
- **Budget**: the gene points a generated species spends, set per Niche
  by a Curve over depth.
- **Mutant** (planned): an individual whose values differ from its
  species: stronger, or with a need its species lacks.
- **Boss** (planned): one boosted apex per Stratum, with the boss Rank,
  named and announced to the player.
- **Litter**: the offspring of one `breed` action, placed on free cells
  around the parent; a crowded neighbourhood gives a partial Litter.
- **Remains** (planned): what a death leaves on its cell: a carcass that
  persists as food.

## Server and client

- **Command**: what a client sends for its player's turn (`move`, `wait`, `eat`).
  The server maps it to an engine action. Not an Intent.
- **Gesture**: what the player asks for (a key, later a click), before it
  becomes a Command. Code: `Gesture` (`apps/web/src/play/types.ts`).
- **Play**: the client's state of one game: status, last Snapshot, command
  in flight, notice. Code: `Play` (`apps/web/src/play/types.ts`).
- **Session**: One connection owns one Session. A Session holds one World
  and one player, in memory. Code: `Session` (`apps/server/src/session.ts`).
- **Snapshot**: the server's message to the client after each of its
  player's turns. Not an Image, which is saved floor bytes.
