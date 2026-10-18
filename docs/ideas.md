# Out-of-scope ideas

Everything outside the current scope. An idea leaves this file only when
the spec is updated to include it.

## Living world

- Elements that spread from floor to floor: fire, water, vegetation, corruption.
- Factions: territories, alliances, wars between groups of creatures.
- Individual memory: monsters that remember the player and become rivals.
- The dungeon keeps living while the player is disconnected (server).

## The island

- Hub between runs, in real time.
- Role to define: progression, building, narrative.
- Monsters defeated without being killed join the island as inhabitants.
- Seeds grown on the island, planted in the dungeon.

## Grand concepts

- The island rests on the back of a sleeping titan; the dungeons are its body.
- Fights on the back of a moving colossus: the grid tilts and collapses.
- The ocean rises with every run, and the island shrinks.
- A corrupted reflection of the island under the sea.

## Mechanics

- Sculptable terrain: raise or dig blocks.
- A tide that rises in the dungeon.
- Light as a resource.
- Echoes of past runs that replay their actions.
- Bites through `harm` and carcasses: predation wounds instead of killing, and the body stays as food. Planned in `docs/plans/generative-species.md` (S2, N1).
- Creatures avoid stepping into fire even without fear, when they move for another reason.
- An `Edible { class, nutrition }` contract on edible species, once fear reads it for its danger masks (`docs/plans/rust-hunger.md` §5).
- Module-declared events, registered at build beside core's `Died` and `Spawned`, once a host reader needs one (`docs/plans/rust-hunger.md` §4).
- Pathfinding for creatures that approach a target: hunger's `Approach` takes one greedy step and fails against a wall (`docs/plans/rust-hunger.md` §5).

## Generated species

See `docs/plans/generative-species.md`.

- Store the Catalogue in the save and bump `FORMAT_VERSION` at the first persisted world, so a generator change no longer breaks saves.
- A speed gene. Blocked by fear's `MARGIN`: fear's stamps assume every action costs one turn.
- A metabolism gene: satiety decay per species.
- Generated producers: forage species drawn from archetypes like consumers.
- A birth cost for the parent. Needs a hunger contract the reproduction module can read.
- Display-name epithets grown from the archetype stem.
- A global herbivore cap, if the local bounds on breeding fail to hold the population.

## Tooling

- Config in JSON, editable without touching code: level editor, modding, live tuning.
- Engine API for the server (snapshots): type the meaning of each event's `a`/`b` payloads, export `TICKS_PER_TURN` to its first caller.
- Events and the cause of death in the snapshot sent to the client.
- Binary frames for the snapshot, only if a size measurement on a real floor justifies it.
- `world.size()` once the server loads a saved game.
- Starter stoats that begin hungry (per-entity `values` in `world/starter.ts`), so predation shows from the first turns.
- Creature satiety in the debug view, to see when a predator starts hunting.
- Terrain readers on `Grid` (material, height, slope): they wait for their first consumer.
- An unordered row scan in `korr-ecs`, for a bulk pass that needs no id order.
- Decision LOD (P above 1) in the Rust core, only if the bench at target scale exceeds the budget, and then behind season-bench fidelity checks. The `perceiving` case of `round_8k_2k` measured 366 ns per entity against a budget of about 200, with a proposer that does nothing but step. The full decision at P = 1 stays unverified until hunger gives a real proposer.
- Snapshot-decision turns (every actor decides on the round's start state, then all act), if the bench fails.
- The floor stopping in phase 2 when a player is due (D13), with the server supplying the input.
- The two-phase build test of the core design: a reader registered before its owner resolves. It waits for the first cross-module `Read<T>` (hunger).
- `korr-random` hard-codes the `Phase` list: a mechanic with a phase of its own edits the RNG crate. Derive the phase key from a name, like `ModuleKey`, once a module needs its own phase.
- `Subject::Cell` packing the floor, so two floors never share a cell subject.
- Split `korr-grid` `tests/model/driver.rs` by subject. Do not merge it into
  a korr-ecs driver: korr-ecs cannot depend on korr-grid, and the grid
  driver calls the store only to mint handles and ids.
- `Store` is a pass-through over `Entities`, and the `Arrival` token
  duplicates what `attach` already checks: fold them when korr-ecs next
  changes shape.
- `join.rs` and `Store::values_mut` serve only korr-ecs-bench: move them
  behind the bench or delete them when a mechanic needs neither.
- The environment phase walks every cell of every cell column, even a bare
  one: about 2 ns per cell. At low actor density this dominates the round
  (128x128 with 1.6k actors: +52%). Skip all-zero rows, or keep a list of
  active cells, once a cell budget for many columns is set.
- A parallel barrier: `send` and `land` work per floor and can go through
  the same `Runner`. Only if the `barrier` bench, with travellers, shows the
  serial barrier takes a real share of the round.
- Lend module columns for the actor loop, as the core lends clock and
  intent: it removes the per-entity `type_id` downcast in a module's
  `get`. Hunger idles at about 35 us per round on `round_8k_2k/wander`
  (4.8%); a build with no downcast at all gains only about 2% on wander and
  feeding, so the rest is satiety memory access. It costs about 280 lines,
  a module API change, and a despawn route that must clear every lent
  column. Only when a module's idle cost is measured above that bound.
- A bench threshold guard: a script that runs the alternated A/B of
  `round_8k_2k` and `floors` against a base and fails past a set margin,
  so a module's cost is checked without a manual bench session.

## Visuals

- 3D with pixel-art textures, stepped terrain, soft light, desaturated palette.
- Models made in MagicaVoxel.

## Multiplayer

- Turn model with several players: simultaneous turns, timer, who waits for
  whom. The engine stays neutral: it stops when a player is due, and the
  server supplies the inputs (see `docs/plans/ecs-core.md`, D13).
- Floors without a player that advance asynchronously, within one round of
  their neighbours.
- Class-aware alarms: an alarm byte holds eaten-class bits, but `alarmed()` wakes every actor with the required components. With a second prey class, check the bits against the actor's own class.
- Reactive far floors: an alarm stamped over sight (radius 3), separate from danger's reach (4), wakes far rats when a predator comes into view, so they really flee and watch. Measured +28% world round (`docs/plans/creature-decision.md`, D6). Needs a second stamp in fear.
