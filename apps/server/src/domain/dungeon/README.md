# `domain/dungeon`

Deterministic procgen. Pure passes `(Level, Rng) → Level` composed into per-style pipelines. Same seed ⇒ byte-identical `Level`.

> Full architecture, pass-by-pass walk-through, rejected alternatives, and the determinism contract live in `docs/PROCGEN.md`. This README is the entry-point reference.

## API

```ts
import {
  generateLevel,     // (rng, w, h, style: StyleId) → Level
  runPipeline,       // (level, rng, passes: Pipeline) → Level
  emptyLevel,        // (w, h) → Level   (all-wall, no rooms, no spawn)
  type StyleId,      // "rim" | "caverns"
  type Level,
  type Grid,
  type Room,
  type Pass,
  type Pipeline,
  type Tile,
  TILE_WALL,         // 0
  TILE_FLOOR,        // 1
  TILE_DOOR,         // 2
  // Grid helpers (used by passes and downstream renderers):
  idx, inBounds, getTile, DX4, DY4,
} from "./domain/dungeon";
```

## Styles

Two pipelines ship today; each is a folder under `styles/` with five passes.

| Style | Aesthetic | Perf @300×150 |
|---|---|---:|
| `"rim"` | Brogue-style room accretion. Rectangular rooms with door-connected corridors. | ~0.03 ms |
| `"caverns"` | Cellular-automata caves. Organic, irregular shapes. | ~2 ms |

Adding a style = new folder under `styles/`, a `Pipeline` constant, and one line in `PIPELINES`. The dispatch table in `index.ts` does the rest.

## Architecture

Pure-pass pipeline:

```ts
type Pass = (level: Level, rng: Rng) => Level;
type Pipeline = ReadonlyArray<Pass>;
```

Each pass returns a new `Level` value. The `Grid.tiles: Uint8Array` is the only mutable bit — passes write through it for perf, but the rest of the structure (rooms, spawn, downStairs) is replaced by-value. Passes never mutate the `Level` they receive in a way the caller can observe past the return.

`runPipeline(level, rng, passes)` is just `passes.reduce((acc, p) => p(acc, rng), level)`.

## Tile encoding

`Grid.tiles` is a `Uint8Array` of length `width × height`, indexed row-major (`idx(x, y, w) = y * w + x`). Values: `TILE_WALL = 0`, `TILE_FLOOR = 1`, `TILE_DOOR = 2`.

A door tile lives on the grid AND is referenced by `doors` on **both** rooms it connects (the same `[x, y]` appears in two rooms' `doors` arrays). One door tile, two room-side references — that's the convention. Loops added by `addLoops` are an exception: they're standalone door tiles with no room-side reference.

## Spawn and stairs

`Level.spawn` and `Level.downStairs` are `readonly [number, number] | null`. `null` (not `?:`) is the explicit "no value yet" — `exactOptionalPropertyTypes` is on, so the discriminator stays visible at every reader.

By project convention, the player respawns at `level.spawn` on zone entry (see `game/transition.ts:enterZone`). Rim sets spawn to the center of the first placed room (always a floor cell). Caverns picks a uniform-random floor tile via `rng.int(0, floorCount - 1)` after `connectComponents` has merged all floor regions.

## Determinism contract

- Same `(rng state, w, h, style)` ⇒ byte-identical `Level`.
- 200 seed-runs per style pinned via FNV-1a hash regression in `styles/{rim,caverns}/tests/determinism.test.ts`. Hash drift = STOP (intentional regen in the same commit, or a real bug).
- All randomness flows through the passed `Rng`. Passes never call `Math.random()` or read clocks.

## CLI

```bash
cd apps/server
bun run preview --style rim --seed 42
bun run preview --style caverns --seed 7
```

Renders a 80×30 ASCII preview to stdout. Useful for eyeballing a style change without running the full server.

## Tests

`bun test src/domain/dungeon` covers grid helpers, per-pass invariants, per-style integration, edge cases, and the determinism pins. Bench scripts: `bun run bench:dungeon:connect`, `bun run bench:dungeon:stairs`.

## Why this and not the alternatives

| Alternative | Why not |
|---|---|
| **Single monolithic generator function per style** | Hard to test individual passes; hard to mix-and-match for new styles. |
| **Object-oriented "generator" class with internal state** | Hides the determinism contract — passes can leak state across invocations. Pure-function pass keeps the contract visible. |
| **External lib (ROT.js, etc.)** | Algorithm opaque, RNG injection awkward, perf unknown, deterministic-across-runtimes claim unverified. We control the substrate. |
| **Async / generator passes** | Pure sync makes the pipeline a `reduce`; async adds complexity for zero gain (no I/O in procgen). |

Full rationale: `docs/PROCGEN.md`.
