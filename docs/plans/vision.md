# Vision: the dungeon that never dies

The target the other plans serve. Decided with the user on 2026-10-09.
Open points stay marked as open.

## The world

- One dungeon, forever. It is never reset or regenerated.
- When the player dies, the server jumps one season: it simulates N rounds
  at once. The next character enters a world that went on without them.
- The ecosystem drives evolution. Predation, hunger and competition select
  species across seasons. The player is one pressure among others.
- Difficulty is free. The dungeon may become hellish or peaceful; the
  player adapts.

## The dungeon is alive

- The dungeon is the titan's body, and an organism with its own needs.
- Two levels of reaction to the intruder:
  - Creatures react on their own: they learn to fear or hunt the player.
  - The dungeon reacts when the disturbance grows too strong: it spawns
    defenders, fills empty niches, mutates its species.
- An extinction is a wound the dungeon heals, not a dead end.
- The dungeon is an actor with needs, under the core rule. Never a
  parallel system with its own decision logic.

## The player

- Keeps a bestiary of what they observed. An entry can go stale when a
  species evolves: that is how the player sees the world change.
- Keeps the island, which grows: tamed inhabitants, seeds.
- Goal: open.

## Species

- Hand-authored archetypes per niche, varied by the seed
  (`generative-species.md`).
- Each individual carries a genome. Birth passes it on with mutations.
  Genomes persist across birth, travel, save and season jumps.
- Variation by discrete verbs (burrows, swims, steals, splits) carries
  what the player sees. Number traits stay too, even when they are not
  visible.
- Each archetype lists the verbs it can acquire. A mutation can grant a
  verb from that pool; a speciation can widen the pool.
- Genes also set temperament: they weigh needs (boldness lowers fear,
  voracity raises hunger, curiosity raises exploring). Two rats of one
  species act differently, and selection shapes the species' character.
- A population that drifts far enough from its origin becomes a new
  species, with its own name and bestiary entry.
- Mutants and named bosses stand out from their species.

## Social life

Target, in this order of weight:

- Groups: packs that hunt together, herds that flee together.
- Territories: a group defends and marks an area; borders move with the
  seasons.
- Relations between species: symbiosis, parasites, scavengers that follow
  predators, alliances.
- Individual bonds (pairs, parents, revenge): the heaviest, comes last.

## Scale

- Density varies by floor and is itself an outcome of the ecosystem.
- Up to ~40 floors. The engine is sized for 50 floors of 10k entities,
  about 100 ms a round (`ecs-core.md`, `creature-decision.md`).
- The season jump is the cost risk: measure it on a realistic world early.
  A port away from TypeScript is decided on that measurement, never before.

## What this demands of the structure

- Persistence: the catalogue and every genome live in the save.
- Season jump: thousands of rounds on every floor, fast and deterministic.
- Legibility: looks, the bestiary and visible intent show what evolved.
- Bricks: a new verb, archetype or dungeon reaction is data or one module
  folder.
