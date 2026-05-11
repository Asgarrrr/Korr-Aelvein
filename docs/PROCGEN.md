# Procgen — dungeon generation

The procgen system lives in `apps/server/src/domain/dungeon/`. It produces
`Level` objects on demand from a seed. **Server-authoritative**: the client
never runs procgen, only renders what the server sends. **Deterministic**: a
given (seed, style, w, h) always produces the same `Level` byte-for-byte,
across V8/JSC and any platform.

## Mental model

A `Pass` is a pure function `(level: Level, rng: Rng) => Level`. A `Pipeline`
is `ReadonlyArray<Pass>`. `runPipeline` left-folds passes over an initial
empty level. A `Style` is just a `Pipeline` with chosen parameters.

```ts
generateLevel(rng, w, h, "rim")
  = runPipeline(emptyLevel(w, h), rng, PIPELINES.rim)
  = passes.reduce((acc, pass) => pass(acc, rng), emptyLevel(w, h))
```

**There is no framework.** No registry, no DSL, no plugin loader. Adding a
style = adding a folder with passes and an `index.ts` that exports a
`Pipeline` constant. The `PIPELINES` record gets one new entry. That's it.

## The `Level` type

```ts
type Level = {
  readonly grid: Grid;
  readonly rooms: ReadonlyArray<Room>;
  readonly spawn: readonly [number, number] | null;
  readonly downStairs: readonly [number, number] | null;
};

type Grid = {
  readonly width: number;
  readonly height: number;
  readonly tiles: Uint8Array;            // length = width * height
};

type Room = {
  readonly x: number; readonly y: number; // top-left
  readonly w: number; readonly h: number;
  readonly doors: ReadonlyArray<readonly [number, number]>;
};
```

Tile values (`apps/server/src/domain/dungeon/types.ts`):

| Const | Value | Glyph (preview) | Meaning |
|---|---|---|---|
| `TILE_WALL` | `0` | `#` | impassable rock |
| `TILE_FLOOR` | `1` | `.` | walkable space |
| `TILE_DOOR` | `2` | `+` | walkable, semantically a doorway |

`spawn` and `downStairs` are level fields, not tiles. The rendering layer
overlays glyphs (`@` and `>`) at those coordinates over the underlying floor.

## File layout

```
apps/server/src/domain/dungeon/
├── types.ts                            Tile, Grid, Room, Level, Pass, Pipeline
├── grid.ts                             idx, inBounds, getTile, setTile, DX4/DY4
├── index.ts                            public surface: generateLevel, StyleId,
│                                       emptyLevel, runPipeline, re-exports
├── tests/                              source-mirrored unit + adversarial tests
│   ├── grid.test.ts                    foundation unit tests
│   ├── index.test.ts                   runPipeline + emptyLevel tests
│   └── properties.test.ts              adversarial Phase 0 (foundation)
└── styles/
    ├── rim/                            Brogue-style room accretion
    │   ├── index.ts                    RIM pipeline + per-pass re-exports
    │   ├── place-first-room.ts           centred starting room
    │   ├── accrete-rooms.ts             attach rooms via single-door perim
    │   ├── add-loops.ts                 break the room-tree into a graph
    │   ├── place-stairs.ts              stairs in the farthest room
    │   └── tests/
    │       ├── place-first-room.test.ts
    │       ├── accrete-rooms.test.ts
    │       ├── add-loops.test.ts
    │       ├── place-stairs.test.ts
    │       ├── integration.test.ts     smoke + regression
    │       ├── invariants.test.ts      38-seed × ~10 structural invariants
    │       ├── determinism.test.ts     byte-identical re-runs + 100-seed hash pin
    │       └── edge-cases.test.ts      degenerate inputs
    └── caverns/                        cellular-automata caves
        ├── index.ts                    CAVERNS pipeline + per-pass re-exports
        ├── seed-ca.ts                   random fill, border forced WALL
        ├── iterate-ca.ts                4-5 rule, double-buffered, interior-fast
        ├── connect-components.ts        multi-source BFS over walls + parent-walk
        ├── place-cavern-spawn.ts         rng-pick on floor tiles
        ├── place-cavern-stairs.ts        BFS-farthest floor from spawn
        └── tests/
            ├── seed-ca.test.ts
            ├── iterate-ca.test.ts
            ├── connect-components.test.ts
            ├── place-cavern-spawn.test.ts
            ├── place-cavern-stairs.test.ts
            ├── ca-correctness.test.ts  pass-level CA properties
            ├── integration.test.ts     smoke + regression
            ├── invariants.test.ts      38-seed × ~10 structural invariants
            ├── determinism.test.ts     byte-identical re-runs + 100-seed hash pin
            └── edge-cases.test.ts      degenerate inputs
```

Tests live in a `tests/` subfolder next to the source they exercise. Source
filenames are **kebab-case** (`connect-components.ts`); exported symbols stay
**camelCase** (`connectComponents`). Imports inside a test file use one extra
`../` level (e.g. `from "../seed-ca"` for a sibling source). Bun's runner
auto-discovers `*.test.ts` regardless of depth.

## Styles in 2026-05

### `rim` — Brogue-style room accretion

Pipeline: `placeFirstRoom → accreteRooms → addLoops → placeStairs`.

Builds a tree of rectangular rooms connected by single-tile `TILE_DOOR`
passages. The 1-cell-perimeter overlap check is stricter than original Brogue:
two rooms can never share a wall — only a door. `addLoops` then breaks the
tree by carving extra doors at walls between rooms whose shortest in-graph
distance exceeds the threshold.

Defaults yield ~25 rooms, ~30 doors at 80×30. Generation: **~0.03 ms** at any
size — essentially free.

### `caverns` — cellular automata

Pipeline: `seedCA → iterateCA → connectComponents → placeCavernSpawn → placeCavernStairs`.

Random fill at 45% wall probability, 5 iterations of the 4-5 rule (B5/S4)
with OOB-as-WALL and explicit border re-force. `connectComponents` runs a
multi-source BFS from every anchor (largest component) floor tile through
walls, and when the wave first touches a satellite component it walks
`parent[]` back to carve a 4-connected tunnel — `O(W·H)` per pass.

Defaults yield ~54% floor, single 4-connected component. Generation:
**~0.25 ms at 80×30, ~2 ms at 300×150**.

## Adding a new style

1. Create `apps/server/src/domain/dungeon/styles/<name>/`.
2. Implement passes in that folder, each as `(level: Level, rng: Rng) => Level`.
   Passes can read `level` but must return a new one; never mutate the input
   beyond a single internal `tiles` clone per pass (the "hot-loop convention").
3. Create `<name>/index.ts` exporting your passes and the pipeline:

   ```ts
   import type { Pipeline } from "../../types";
   import { passA } from "./pass-a";
   import { passB } from "./pass-b";

   export { passA, passB };

   export const MINES: Pipeline = [
     passA({ /* params */ }),
     passB,
   ];
   ```

4. Edit `apps/server/src/domain/dungeon/index.ts`:

   ```ts
   import { MINES } from "./styles/mines/index";

   export type StyleId = "rim" | "caverns" | "mines";

   const PIPELINES: Readonly<Record<StyleId, Pipeline>> = {
     rim: RIM, caverns: CAVERNS, mines: MINES,
   };
   ```

5. Edit `apps/server/scripts/preview-dungeon.ts` (the `isStyleId` guard) so
   `bun run preview --style mines` works.

6. Add a determinism test (`<name>/tests/determinism.test.ts`) — copy the rim or
   caverns version, pin the hash for seeds 0/1/7/42/99. This is the canary
   that catches future drift.

## Adding constraints

Constraints are passes, not a separate system. Three patterns:

**A. Stamp up front (recommended).** Place required content as a pass that
runs *before* the generative passes. The generative passes see it as
existing rooms and work around it. Deterministic, no retries.

```ts
const SHRINE: Pipeline = [
  placeFixedRoom({ x: 36, y: 11, w: 7, h: 7 }),    // mandatory
  accreteRooms({ maxRooms: 25, ... }),              // grows around it
  addLoops(...),
  placeStairs,
];
```

See `apps/server/scripts/preview-shrine.ts` for a working demo of this
pattern, including the `placeFixedRoom` primitive.

**B. Post-validation.** A final pass asserts an invariant; throws on
violation. Caller decides whether to retry with a new seed.

**C. Generate-and-test (rejection sampling).** Wrap `generateLevel` in a
loop that retries with `createRng(baseSeed + attempt)`. Stays deterministic
(same base seed → same attempt chain → same outcome), at the cost of
expected retries.

```ts
function generateConstrained(
  baseSeed: number, w: number, h: number, style: StyleId,
  ok: (level: Level) => boolean,
): Level {
  for (let attempt = 0; attempt < 16; attempt++) {
    const lvl = generateLevel(createRng(baseSeed * 1000 + attempt), w, h, style);
    if (ok(lvl)) return lvl;
  }
  throw new Error("constraints unsatisfiable");
}
```

## Determinism guarantees

What we promise:

- Same `(seed, style, w, h)` → byte-identical `Level` across V8, JSC, and any
  IEEE-754-conforming JS runtime, on any platform/architecture.
- Same RNG state passed via `Rng` → same RNG draws regardless of which pass
  it's in. RNG ordering is part of the determinism contract: inserting an
  RNG-consuming pass anywhere in a pipeline shifts every downstream pass's
  outputs. See `project_design_decisions.md` for the rationale.

What enforces it:

- `sfc32` PRNG uses pure 32-bit integer arithmetic (`| 0`, `Math.imul`),
  no BigInt, no float-drift-prone operations.
- All randomness flows through `Rng` (`apps/server/src/domain/rng/`). Grep
  confirms zero `Math.random`/`Date.now`/`performance.now`/`crypto` in
  production code.
- Tiles use `Uint8Array` (byte-deterministic by WebIDL spec).
- `Array.sort` in JS is Timsort (stable). Our only tie-breaking sort is in
  `connectComponents` (size desc); ties break by component-discovery order,
  itself deterministic (scan-order flood-fill).
- `Map`/`Set` iteration is insertion-order per JS spec.

What's tested:

1. **Same-seed re-run** (`styles/{rim,caverns}/tests/determinism.test.ts`):
   10 seeds × 2 styles, two consecutive `generateLevel` calls produce
   deep-equal `grid.tiles`, `rooms`, `spawn`, `downStairs`.
2. **Pinned regression for seed 42** (rim + caverns): exact (rooms, floor,
   wall, door, spawn, stairs) tuple.
3. **100-seed hash regression**: FNV-1a 32-bit hash of `(tiles + spawn +
   stairs)` for each of seeds 0..99; 5 hashes pinned per style; sanity
   `≥ 95 of 100 distinct`. Catches any algorithmic drift that affects
   more than ~1% of the seed space.
4. **38-seed structural invariants** (`tests/invariants.test.ts`): connectivity,
   no-overlap, border-closed, no-orphan-tiles — re-verified for every seed.

## Performance

Median of 5 batches × 300 iterations after warmup, on Bun 1.3 / M-series:

| style    | 80×30 | 200×100 | 300×150 |
| -------- | ----- | ------- | ------- |
| rim      | 0.04 ms | 0.02 ms | 0.03 ms |
| caverns  | 0.10 ms | 0.88 ms | **1.98 ms** |

`bun run bench` in `apps/server/` benchmarks the RNG only. For full
`generateLevel` timing, use the inline pattern in
`apps/server/scripts/preview-dungeon.ts` (which prints `gen=X.XXms` on
each run) or invoke directly with `bun -e`.

Caverns dominated by `connectComponents` (~40-50% at 300×150) and
`iterateCA` (~30-35%). The history is documented in
`project_design_decisions.md`: O(N²) → O(W·H) via multi-source BFS
(round 1), then branch-free Moore-counting via floor-sum + LUT and the
interior-fast-path in `iterateCA` (round 2). Total speedup vs the
initial algorithm: **~95×** at 300×150.

## Tools

```bash
# In apps/server/
bun test                                  # full test suite (1120+ tests)
bun run check-types                       # tsc --noEmit
bun run lint                              # biome check
bun run preview                           # rim, seed 42, 80×30
bun run preview --style caverns --seed 7
bun run preview-shrine                    # constraint-as-pass demo
```

The preview scripts respect `--no-color` and auto-disable colors when
stdout is not a TTY.

## Things we deliberately rejected

| Idea | Why not |
|------|---------|
| Wave Function Collapse for layout | Exponential in grid size; contradictions; non-deterministic propagation order across engines. Layer it as a content pass *inside* rooms later, à la Caves of Qud — not as the layout primitive. |
| Graph grammars (Dormans / Ludoscope) | Real authoring tool with 5000+ rules; no maintained TS port. Revisit when narrative-pacing pressure demands it. |
| Bit-packed CA + SWAR | 4-8× theoretical win on `iterateCA`, but our border-as-WALL invariant breaks the elegant column-shift trick. Not justified below ~500×500. |
| WASM compute kernels for hot loops | Bun's JS↔WASM boundary is real (~50-200 ns/call); net loss below ~1 ms-per-call kernels. Maintenance tax too high. |
| Persistent visited buffer pool across `generateLevel` calls | Premature; 4.5 ms → 2 ms via better algorithms made it irrelevant. |
| `as const` / non-null assertions for terseness | Banned project-wide. `Tile` constants use explicit literal annotations; `Uint8Array` reads under `noUncheckedIndexedAccess` use runtime guards or short-circuiting `undefined` checks. |
| `Result<T, E>` / `Either` library | `throw` is idiomatic JS/TS. Re-evaluate at WS boundaries if typed errors there become valuable. |
| Preemptive `packages/game-core` extraction | The trigger is "same type duplicated between client and server". Until then, types live in `apps/server/src/domain/dungeon/`. |

## Future work

In rough priority order:

1. **Wire procgen to `GameState`**: define a `GameState` containing a `Level`
   plus player position, depth, `rngState`. Add reducers for `move`/`descend`.
   Hook up the WS handler. This is where the deterministic generator pays
   off — every replay of the same seed + action stream yields the same
   game. The infra is ready (`Level` is serializable, `Rng` snapshots cleanly).

2. **Content passes**: monsters, items, decorations (lakes, lava, traps).
   These are level-decorating passes that run after layout. Blocked on (1)
   — placing entities without an entity model is wishful thinking.

3. **Multi-level descent**: a `depth → styleId` mapping (e.g. rim 1-3,
   mines 4-7, caverns 8-12, abyss 13+), per-level seed scheme (likely
   `rng.split()` once per level descent), and persistent level cache so
   the player can ascend and find the same maps.

4. **More styles**: `mines` (drunkard tunnels), `crypts` (cramped accretion),
   `maze`, `abyss_touched`. The architecture handles them by construction;
   add them when gameplay design pulls.

5. **Visual fidelity**: client renders the level. Currently the only renderer
   is the terminal preview script. The client will use `<canvas>` or a 2D
   WebGL tilemap, fed by `GameState` deltas over the WS.

## References

- Brogue dungeon generation breakdown — anderoonies, 2020:
  http://anderoonies.github.io/2020/03/17/brogue-generation.html
- Cogmind procedural map generation — Grid Sage Games, 2014-2015:
  https://www.gridsagegames.com/blog/2014/06/procedural-map-generation/
- Cellular Automata cave generation — RogueBasin:
  https://www.roguebasin.com/index.php/Cellular_Automata_Method_for_Generating_Random_Cave-Like_Levels
- The Incredible Power of Dijkstra Maps — RogueBasin:
  https://www.roguebasin.com/index.php/The_Incredible_Power_of_Dijkstra_Maps
- sfc32 PRNG — see `apps/server/src/domain/rng/index.ts` header comment.

## Maintenance

This file is checked in. Keep it concise — when it grows past 250 lines,
split it (e.g., `docs/PROCGEN-PASSES.md` for per-pass deep-dives). When
adding a style, add a row to "Styles in 2026-05" with a one-paragraph
summary. When rejecting a SOTA option after research, add it to "Things we
deliberately rejected" with the why.
