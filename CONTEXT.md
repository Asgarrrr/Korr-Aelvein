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
- **Species**: which components an entity starts with, and their values.
  Content data, compiled once per world. Each entity saves its species as
  an index into the world's sorted species names; 0 means unnamed (spawned
  from a shape, tests only), and `entities` refuses unnamed entities.
- **Actor**: an entity the scheduler runs. A **player** is an actor whose
  decision comes from a recorded input.

## Decisions

- **Need**: what a creature acts to satisfy. Every behaviour extends needs
  or the environment that shapes them.
- **Candidate**: a scored (action, target) a module proposes for an actor.
  The core picks one per actor.
- **Goal action**: an action whose target persists across turns (eat this
  food, flee this threat). It reaches `core.step` through `instead`.
- **Intent**: the cached (action key, target) of an actor's last decision.
  A matching candidate gets inertia; a FAIL clears it.
- **Period (P)**: how often an actor re-decides. Set per floor by distance
  to the nearest player; between decisions the actor repeats its intent.
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
- **Game**: the registry plus the species table: what the server runs.
  Code: `game` (`packages/engine/src/game.ts`). `createGame` / `loadGame`
  build a World running the Game.

## Server and client

- **Command**: what a client sends for its player's turn (`move`, `wait`, `eat`).
  The server maps it to an engine action. Not an Intent.
- **Session**: One connection owns one Session. A Session holds one World
  and one player, in memory. Code: `Session` (`apps/server/src/session.ts`).
- **Snapshot**: the server's message to the client after each of its
  player's turns. Not an Image, which is saved floor bytes.
