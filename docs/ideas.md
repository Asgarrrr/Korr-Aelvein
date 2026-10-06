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
- Bites through `harm` and carcasses: predation wounds instead of killing, and the body stays as food.
- Creatures avoid stepping into fire even without fear, when they move for another reason.

## Tooling

- Config in JSON, editable without touching code: level editor, modding, live tuning.
- Engine API for the server (snapshots): type the meaning of each event's `a`/`b` payloads, export `TICKS_PER_TURN` to its first caller.
- Events and the cause of death in the snapshot sent to the client.
- Binary frames for the snapshot, only if a size measurement on a real floor justifies it.
- `world.size()` once the server loads a saved game.
- Starter stoats that begin hungry (per-entity `values` in `world/starter.ts`), so predation shows from the first turns.
- Creature satiety in the debug view, to see when a predator starts hunting.

## Visuals

- 3D with pixel-art textures, stepped terrain, soft light, desaturated palette.
- Models made in MagicaVoxel.

## Multiplayer

- Turn model with several players: simultaneous turns, timer, who waits for
  whom. The engine stays neutral: it stops when a player is due, and the
  server supplies the inputs (see `docs/plans/ecs-core.md`, D13).
- Floors without a player that advance asynchronously, within one round of
  their neighbours.
