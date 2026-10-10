# Design: the Rust grid

The third foundation leaf of the Rust rewrite (`rust-structure.md` §0),
after `korr-random` and `korr-ecs`. Brainstormed with the user on
2026-10-10, informed by two research reports and a map of how the TS
engine uses its grid.

## User decisions

- Floors are variable rectangles: each floor has its own size, chosen by
  worldgen at creation.
- Terrain is material and height from the start.
- Large creatures are in the vision: only actors may cover several cells.
- First delivery: shape, coordinates, neighbourhoods, terrain, occupancy.
  Cell field layers come with `flora`, their first real consumer. FOV and
  Dijkstra maps come with the mechanics that need them.

## What the TS engine needs (reference, not a spec)

- `cellAt(x, y)` with off-floor as "no cell"; insert, remove and move of an
  entity; "does another actor hold this cell?" (the hottest call); walking
  the entities of a cell; a version counter so a cached perception knows
  it is stale.
- Every neighbourhood query is a Chebyshev square of radius ≤ 4, or the 8
  neighbours of a cell.
- No walls, no FOV, no pathfinding: `approach` is one greedy step.

## 1. Components

Crate `crates/sim/grid/`, `korr-grid`, `no_std`, depends on `korr-ecs`
only. `korr-core` later assembles it into `Floor`.

| Type | Role |
|---|---|
| `Shape { width, height }` | Per-floor size, includes a one-cell wall ring. |
| `Pos { x: i16, y: i16 }` | API coordinate: distances, serialization, protocol. |
| `CellIdx(u32)` | Opaque linear index of any padded cell, ring included. Readers take it. |
| `Interior(CellIdx)` | An interior cell. Only `Shape::idx(Pos) -> Option<Interior>` and the neighbourhood scan mint one. Writers and stencil centres take it. |
| `Material(u8)` | Material id. Its properties (walkable, opaque, liquid) are a table in `config.rs`. Material 0 is the ring wall. |
| `Terrain` | Two SoA layers: `material: Vec<Material>`, `height: Vec<i8>`. |
| `Occupancy` | `actor: Vec<u32>` (slot or a `u32::MAX` sentinel, 4 bytes per cell) for a one-load blocking test, plus an intrusive list for non-actors. |
| `Grid` | `Shape`, `Terrain` and `Occupancy` of one floor. |

Invariants:

- The wall ring makes the 8 neighbours of every `Interior` cell in bounds:
  `Shape::neighbour(Interior, Dir) -> CellIdx` needs no branch. A ring
  cell reads `WALL` and no actor. Chebyshev squares of radius > 1 still
  clip at the ring.
- Writers panic on an `Interior` that is not an interior cell of their own
  shape: floors of different shapes coexist.
- Only actors may cover several cells. Every cell of an actor's footprint
  points to it in `actor`. The footprint is always 1x1 for now.
- Items, plants and corpses occupy exactly one cell.
- Order inside a cell is ascending `EntityId`, never slot order: slots are
  recycled and change when an entity travels.
- `Position` is the source of truth. Occupancy is a derived index: never
  saved, rebuilt on load and on a traveller's arrival.
- A step is legal when the target material is walkable, |Δh| ≤ `MAX_STEP`
  (config), and no other actor holds the target cell.

## 2. Data flow

- The core is the only writer: spawn, despawn and `move_to` link and unlink
  the index. Modules read terrain and occupancy, never write them.
- Neighbourhood iteration yields cells in a fixed scan order: Chebyshev
  ring, then row-major within the ring, then in-cell order.
- `korr-ecs` exposes a read-only `SlotIdx` (`Handle::slot()`), which never
  leaves a core callback. The grid owns its link arrays, indexed by slot
  and grown on demand. Links are not ECS columns: every column is saved and
  travels, and occupancy must do neither.
- Each link keeps the full `Handle` and the `EntityId`. A stale handle on a
  recycled slot never touches the newer entity, and in-cell order compares
  ids, never handles (`Handle` orders by slot).
- Placement can fail without a panic: `can_place(at, Layer)` (walkable,
  and no actor for `Layer::Actor`; height is not a placement rule) and
  `nearest_place(from, Layer)` over the neighbourhood scan. A traveller
  stays queued while its destination has no place.
- Shape and terrain persist through the `korr-ecs` codec. The core's floor
  image carries the header and checksum.
- Whether a version counter is still needed depends on how `wander` caches
  perceptions: decide when `wander` lands, not here.

## 3. Errors

- An out-of-bounds `Pos` is `None` from `Shape::idx`, never a panic.
- An illegal step (wall, height, occupied) is a typed `Result` error: the
  action fails, the game goes on. Height difference is computed in `i16`:
  an `i8` subtraction overflows.
- Rebuilding occupancy on load returns an error on bad input: two actors on
  one cell, a position off the shape, on the ring or on a non-walkable
  cell. Untrusted bytes never panic.
- Linking an actor onto a cell another actor holds, or unlinking an entity
  that is not linked, breaks an invariant: panic naming it.

## 4. Tests

- A model test in the style of `korr-ecs` `tests/model/`: random spawns,
  moves and despawns against a naive reference, then `check_grid()`
  re-derives the index from positions and compares.
- In-cell order is ascending `EntityId` after slot recycling, after a
  rebuild from an image, and after travel.
- Shape: `idx` refuses every ring and outside position; every interior cell
  has 8 in-bounds neighbours; Chebyshev squares clip at the ring.
- Step legality: wall, height step above `MAX_STEP`, occupied cell.
- A criterion bench for "actor here?" and `move_to`, inside the 120 ns
  actor-turn budget.

## Prior art and evidence

- Occupancy: DCSS keeps one monster index per cell (`mgrid`) plus a linked
  list of items (`igrid`). The bracket-lib tutorial (ch. 57a) moved from a
  per-turn rebuild to incremental `move_entity` after stale-index bugs.
- Multi-cell: Cogmind stamps the same handle in every occupied cell and
  warns that retrofitting large creatures is costly.
- Storage: largest known floors (Cogmind 200x200 = 40k cells) fit in L2 per
  `u16` layer; tiling and Morton order help only above ~256x256.
- Crates: none is `no_std`, float-free and maintained (bracket-lib and
  doryen-fov use `f32`; `pathfinding::dijkstra_all` returns a std
  `HashMap`). Hand-roll the grid, later the FOV (Albert Ford's symmetric
  shadowcasting in integer rationals) and shared Dijkstra maps (`u16`,
  Brogue style).

## Rust skills to load

Per `.claude/rules/rust.md`: `m05-type-driven` (`Pos`, `CellIdx`,
`Material`, invalid states), `m10-performance` (the blocking test, bounds
check elimination with row slices, the bench), `m06-error-handling` (step
errors against invariant panics), `m01-ownership` and `m03-mutability`
(the `Floor` borrow split between store and grid), `m04-zero-cost`
(neighbourhood iterators, no `dyn`). Run `m15-anti-pattern` on the diff
before reporting done.
