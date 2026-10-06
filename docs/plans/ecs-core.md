# Plan: ECS core (v2, after red/blue review)

Inputs: four research reports (ECS survey, Bun/JSC storage benchmarks,
roguelike domain, TypeScript API), two red-team reports, two blue-team
reports. Prototypes and measurements: `/tmp/korr-ecs-lab`,
`/tmp/korr-redteam-{a,b}`, `/tmp/korr-blue-{1,2}`.

User decisions: events are facts and never drive behaviour. Scale target is
~10k entities per floor and ~50 floors. Decision LOD (D7). Health and death
in core (D9). i32 ids (D2). Multiplayer is planned: several players per
world (D13).

## 1. Success criteria

The reference world lives in `packages/engine/bench/` and runs with
`bun run bench` (not part of `verify`):

- 50 floors, 8k actors + 2k items each, 128x128 grid.
- 10 modules (real ones plus fakes), perception radius 3.
- ~140 B per slot of columns; LOD periods 1/4/16/64.

Budgets (Bun 1.4.3, Apple M5 Pro; prototype in brackets):

| Metric | Budget | Prototype |
|---|---|---|
| World round, all 50 floors advance one turn | median <= 80 ms, p95 <= 100 ms | 74 / 76 ms |
| Player floor alone, full arbitration | <= 20 ms | 13.8 ms |
| Cached-action re-execution | <= 120 ns per actor turn | ~95 ns |
| Bulk tick range scan | <= 20 µs per floor | 10 µs |
| World RSS | <= 160 MB | 113 MB |
| Floor snapshot / fast floor restore | <= 0.1 ms / <= 0.2 ms | 68 µs / 107 µs |
| Floor hash | <= 0.5 ms | 227 µs |

Determinism: same seed and inputs give the same world hash
- across save/load,
- when one floor is restored into a live world,
- with events on or off,
- when the order of floors inside a round is permuted.

Evolvability: a new mechanic touches its folder, `registry.ts`, at most one
`contracts/` entry, and the species files that use it.

## 2. Decisions

### D1. Storage: SoA columns, floor-contiguous slot ranges, fixed capacity

- One TypedArray per field, indexed by slot. Floor `f` owns slots
  `[f*CAP, (f+1)*CAP)`. `CAP` is a power of two in core config (16384).
- Each floor has its own allocator (LIFO free list + high-water mark),
  persisted with the floor.
- Presence of components and tags: mask words per slot.
- On recycle the core zeroes every column of the slot. The zero of every
  field is its absent/default value.
- Field kinds: `i8 u8 i16 u16 i32`, plus `entity` (i32, 0 = none). Use the
  narrowest width.
- Capacity: spawning past `popCap` (game config, below `CAP`) returns NONE.
  Migration arrivals ignore `popCap`. Reaching `CAP` throws (reproducible).
- Cell columns: `cells(name, {field: width})`, one array of `FLOORS*W*H`,
  same ownership rule as entity columns. Built with the first mechanic that
  needs per-cell state (fire).
- Deferred: a sparse storage kind. Trigger: RSS over budget, or a component
  with >= 4 fields on < 10% of entities.
- Rejected: archetypes (churn 1.8x, table explosion with tags), per-component
  sparse sets (5x slower random reads), AoS/Map (memory, 10x random reads),
  global free list (budget-split dependence), growable capacity (stale
  handles).

### D2. Identity

- `EntityId` is an i32: `originFloor * 2^25 + counter`. The counter starts
  at 1 per floor and is monotonic and persisted. 0 = none. Limits: 64 floors,
  33.5M spawns per floor; overflow throws.
- Only the floor where a spawn happens allocates the id, so the sequence
  depends only on that floor's history. An entity keeps its id for life,
  across floors.
- `Slot` is valid only inside one core callback. It is never stored in a
  column, a candidate, a cached action, an event, the inbox or the protocol.
- `id -> slot` is one Int32 open-addressing index per floor (linear
  probing, backward-shift deletion), rebuilt on load, never iterated. An id
  not on this floor resolves to NONE. It rebuilds in 12 µs against 97 µs
  for a `Map`.
- `EntityId` and `Slot` are branded types.

### D3. Floors own their state

A floor owns its slot range and allocator, id counter and id map, grid,
scheduler, events, inbox, and its slices of the cell columns. A floor round
reads and writes only its own state and posts to other floors' inboxes.
Floor order inside a round cannot change the result (tested). Floor-parallel
workers stay possible later with no design change.

### D4. Queries: range scan

- A query is an all-of mask. `q.slots(ctx)` scans the context's floor,
  `[base, base+highWater)`, with a mask test. Valid only for the current callback.
- 10 µs per floor. No list memory, no maintenance, no swap-remove order.
- Upgrade path (same API): cached lists when one scan exceeds 5% of the
  round budget.
- Bulk ticks write only the iterated row, an owned cell column read from
  its owned previous-turn buffer, or an owned cell column they clear and
  fill by an order-independent combine (OR, max). Kills and spawns from a tick are deferred
  and applied after the tick, sorted by (cause EntityId, n). Each module test
  runs its tick on a reversed order and compares hashes.

### D5. Spatial grid

Intrusive linked list per cell. Cell heads are a core cell column; `next`,
`prev`, `cellOf` are core slot columns. All are part of the floor image, so
neighbour order (cell order, then list order) restores verbatim.

### D6. RNG

- `draw(seed, moduleKey, phase, time, subject, n)`: chained `lowbias32`
  with `Math.imul`.
- `moduleKey` = hash of the module name; registration rejects duplicates.
- `phase` in `propose | action | tick | spawn | core`.
- `subject` = EntityId or cell key `floor*W*H + cell`.
- `n` = draw index within one callback.
- Bounded ints: `((h >>> 16) * bound) >>> 16`, bound < 65536.
- Golden-value test and chi-square test.

### D7. Time: lockstep rounds, decision LOD

- Integer ticks, `TICKS_PER_TURN = 100` (core config). Max 2^31-1 ticks,
  asserted.
- Round R covers `[100R, 100R+100)` on every floor. Phases, in order:
  1. ingest inbox arrivals for R, ordered by (time, EntityId);
  2. bulk ticks in registry order (fixed phase, no boundary actor);
  3. actors in (nextAt, EntityId) order;
  4. apply deferred structural changes, recycle slots.
- An action returns a cost >= 1, an alternate (depth capped by
  `MAX_ALTERNATES`), or FAIL. Fractional speed uses an integer remainder
  column.
- Decision LOD (meaning of "same systems at lower frequency"):
  - `P(f) = lodPeriods[tier(distance to the nearest player floor)]`, config
    1/4/16/64 for distance 0 / 1 / 2-3 / >= 4. Fixed at round start.
  - On an actor's turn: full arbitration if `P = 1`, or
    `(turnIndex + EntityId) mod P == 0`, or no cached action. Otherwise the
    core re-executes the cached (action, target).
  - FAIL triggers arbitration at once; a second FAIL idles one turn.
  - Actions, scheduling, ticks and events run every turn on every floor.
    No dt, no catch-up on descent.

### D8. Arbitration: scored candidates

- Perception buffer: built lazily, at most once per acting creature, on the
  first read. Stores slots only; id, dx, dy and dist are derived. Order:
  Chebyshev ring ascending, then cell scan order, then cell list order. It
  is deterministic and part of the floor image; a per-ring sort by
  EntityId cost 125 ns per turn for no behavioural gain.
- `propose(actor, perception, out)` on each module whose required mask
  matches. `out.push(actionRef, target, score)` is typed by the action's
  target kind: `entity` (EntityId), `cell`, or `none`.
- Scores are integers clamped to `[0, SCORE_MAX]`. Divide before multiply.
- Intent = the cached (actionKey, target) of the chosen candidate, core
  state, persisted; the kind follows from the key. A candidate matching the
  intent gets `+INERTIA`. `SCORE_MAX + INERTIA < 2^15`. A FAIL clears it.
- FAIL means "the decision is invalid" (target gone, cornered). A step
  blocked this turn reaches `core.idle` through `instead` and keeps the
  intent; otherwise crowded floors re-arbitrate every turn and LOD saves
  nothing.
- Modules propose goal actions whose target persists across turns (eat this
  food, flee this threat) and reach `core.step` only through `instead`. A
  cached `core.step` to an adjacent cell is dead after one move, which would
  defeat both inertia and LOD re-execution.
- Tie-break: higher score, then lower `actionKey = hash("module/action")`,
  then target kind, then lower target. Registry position is never used;
  duplicate action keys throw.
- An action also receives the actor's perception, reset before it runs (so
  it reflects execute time) and filled only if read; a goal action needs it
  to re-check the whole scene, e.g. fleeing every visible threat.
- An action declares the components its actor must have (`requires`). The
  core fails it, before it runs and at each `instead` hop, on an actor
  without them; audit mode throws on a write into a component the row lacks.
  This is what lets a player send any registered action.
- The chosen action runs in its module's write scope. It must be
  re-executable later with the same (actor, target): it re-validates and
  returns FAIL.
- Built-in core actions: `core.step` (cell), `core.idle`, `core.travel`
  (entity: a stairs entity). Position is core-owned; modules move creatures only by
  proposing `core.step`.
- No candidate: `core.idle`.

### D9. Events, effects, lifecycle

- Events: per-floor FIFO of facts with cause. The cap counts emissions even
  when emission is disabled. No module reads events.
- Effects: `ctx.harm(target: EntityId, amount, cause)` is the only
  cross-module write. Health (`vitality {hp, max}`) is core-owned, next to
  death. The core drains harm at the end of each action and each tick phase,
  sorted by (target, cause, amount). `hp <= 0` calls `kill` with the first
  cause. The buffer is empty at every snapshot point.
- Why `harm` is not events driving behaviour: one consumer (the owner of
  health), applied before the next decision, never crosses a turn, cannot
  choose or schedule an action. Turning events off changes nothing.
- Post-action order: harm, then kills, then spawns. The actor is rescheduled
  only if its EntityId is still alive.
- Death: `kill -> drop -> remove from grid and scheduler -> recycle -> emit
  Died`, direct core calls. "Drop" is a no-op until inventory, which adds a
  core-owned containment relation (`heldBy: EntityId`): the core drops
  contents at death and carries them on migration. No lifecycle hooks.
- Not built: a generic owner-applied request channel. Trigger: the first
  real case `harm` cannot express.

### D10. Modules

```ts
// modules/hunger/schema.ts
export const schema = {
  satiety: { value: "i32" },
  edible: { nutrition: "i16" },
} as const;

// modules/hunger/index.ts
export const hunger = defineModule({
  name: "hunger", schema, config: hungerConfig,
  setup(b, cfg) {
    const satiety = b.write("satiety");          // owned names only
    const fed = b.query(["satiety"]);
    b.tick((floor) => { /* inline loop over fed.slots(floor) */ });
    const eat = b.action("eat", "entity", (ctx, actor, food) => ({ cost: cfg.eatCost }));
    b.propose((actor, perception, out) => { out.push(eat, foodId, score); });
  },
});
```

- Owned names = keys of `schema`; types inferred from it. The registry
  throws on two owners of one name, duplicate module names or keys.
- Reading another module's component (from slice 3): `contracts/` gets the
  entry when the 2nd reader appears; the owner's schema `satisfies
  Pick<Contracts, ...>`. `b.read(name)` returns a getter view
  (`col.get(slot)`) or `undefined` when the owner is disabled. A readonly
  index-signature view was proven to leak writes without any cast; the
  getter view costs nothing measurable.
- Modules keep no mutable state outside registered entity or cell columns.
- Audit mode (tests only: its cost grows with rows x callbacks, so it is not
  a server flag): copies every non-owned column of the floor around each
  callback and diffs element by element; range-checks owned writes against
  the field kind. Touched-row scoping was rejected: a module can write any
  row, so it would need write tracking that costs more than the copy. Core deferred writes run
  outside module attribution.
- Architecture check additions in `modules/**`: forbid casts to TypedArray
  or index-signature types, `as any`, `Reflect.`, `Object.assign`,
  `Object.defineProperty`, `@ts-ignore`, `@ts-expect-error`; forbid
  importing `core/` except `core/api.ts`.
- Bulk ticks are monomorphic inline loops. The "no per-row callback" rule
  applies to bulk ticks only.
- API grows per slice: slice 1 `write, query, tick, action, propose` and
  `ctx.kill/spawn/isAlive/rng`; slice 3 (2nd mechanic) extracts `read`,
  contracts, perception, inertia; slice 4 (3rd mechanic) freezes the core
  API.

### D11. Snapshot and hash

- Floor image, verbatim: header (format version, registry fingerprint,
  floor, round, id counter, highWater, free list), every entity column over
  `[base, base+highWater)` including core columns (EntityId, masks, nextAt,
  speed remainder, intent, grid links), every cell column slice, inbox
  entries (arrival time, EntityId, row bytes).
- World header: seed, round, player floor, the player floor's position in
  its round, `lodPeriods`.
- Rebuilt on load: id map, scheduler order. Transient: events, candidate and
  perception buffers.
- Load validation checks structure and value ranges, never the meaning of a
  module's fields: that would put module rules in core.
- Hash: 2-lane `imul` hash per floor image, combined in floor order. On
  demand only (tests, replays, save checksum).

### D12. Multi-floor time and migration

- Lockstep rounds; nothing advances by a budget-sized partial step. An
  overrunning round adds latency, never changes results.
- Departure at time t moves the row bytes (plus contents, once containment
  exists) into B's inbox at `t + stairTime`. `stairTime >= TICKS_PER_TURN`
  is asserted at config load, so arrival lands in round R+1 or later. An
  arrival at or before the receiver's processed time throws.
- In transit, every floor resolves the id to NONE. A player in transit
  counts toward its destination floor for LOD.
- Restoring one floor into a live world is allowed only at a round
  boundary and only if no travel touched that floor since the image (a
  per-floor traffic counter). Otherwise an entity could exist twice or
  vanish. A whole-world load checks that ids are unique across floors and
  inboxes.
- The input log is not part of a save: the server keeps it to replay.
- Arrival clears the intent: a `Cell` target is floor-local. Entity targets
  stay valid because ids are global.
- A floor pauses when any player on it is due. Round R+1 starts everywhere
  once every floor finishes round R (see D13).

### D13. Several players

- A player is an ordinary actor whose decision comes from an input instead
  of `propose`. Player inputs are recorded with their round and time; a
  replay of (seed, inputs) reproduces the world hash.
- The engine never waits and never reads a clock. It advances until a
  player actor is due and returns the set of due players. The server decides
  when inputs are complete; a timeout becomes an explicit `core.idle` input.
- Default round policy: global lockstep, as in D12. A slow player delays
  every floor by at most one round.
- Upgrade path, not built: floors without players advance asynchronously
  within one round of their neighbours. D3 (floor-owned state) and
  `stairTime >= TICKS_PER_TURN` already allow it.
- The multiplayer turn model (simultaneous turns, timers, who waits for
  whom) is a game design decision for `apps/server`, recorded in
  `docs/idees.md` until scoped.

## 3. Not built (YAGNI)

Archetypes; cached or reactive queries; observers and lifecycle hooks;
generic request channel; generic relations, wildcards, prefabs; generation
bits; parallel workers; per-system access declarations; `Not` queries;
float fields; sparse storage kind; shared response-curve helper; aggregate
distant-floor model; dt-aware step LOD; network delta encoding.

## 4. Slices

Each slice adds behaviour + data + a seeded test, ends with `bun run verify`,
then a red-team and a blue-team review of the diff before the next slice.

1. **A hungry creature lives and dies.** One floor: allocator, ids, columns,
   masks, grid, `core.step`/`core.idle`, scheduler (nextAt, cost >= 1),
   tick phase, argmax with key tie-break, RNG (wander), hunger module
   (satiety + edible), deferred kill, world hash.
   Tests: `hunger-eats` (seed 1, food 5 cells away, eats by turn T);
   `hunger-starves` (death at exactly `ceil(max/decay)` turns); same seed
   twice gives the same hash, golden hash pinned; `runs-without-hunger`;
   RNG golden values.
2. **Food regrows, churn is safe, save/load holds.** Deferred spawns from a
   tick, starvation kills inside the tick, event ring (`Died`, `Ate`), floor
   image and restore.
   Tests: `tick-order-independent` (reversed order, same hash);
   `save-load` (200 + save + load + 300 == 500); hash identical with events
   on and off; cap throws even when disabled.
3. **Predators and fear (2nd mechanic, extract the module interface).**
   `diet` in contracts, fear reads it through a getter view, perception
   buffer, intent and inertia, audit mode, architecture rules.
   Tests: `fear-saves-prey` (median prey survival over 20 seeds higher with
   fear); `audit-catches` (fake module writing a non-owned row throws);
   `runs-without-fear`.
   Added after review: the first cell column, fear's `danger`, cleared and
   OR-stamped in fear's tick around creatures that eat a wary class, so a
   calm wary creature skips the perception fill (~340 ns of fear's ~450 ns
   per sated turn). Needs read-only queries over contract components.
4. **Fire (3rd mechanic, freeze the core API).** Cell columns with an owned
   previous-turn buffer, core `vitality` and `harm`, death by burning, fear
   reads fire cells.
   Frozen cell API (measured: fire tick 430 -> ~21 us per floor): per-floor,
   per-kind reader/writer objects bound through `read(ctx)`/`write(ctx)`,
   `next(cell)` skipping zero words, cheap `cellAt`, grid occupancy through
   `firstAt`/`nextAt`. Raw arrays were rejected: a slot indexes a cell array
   without a cast. Queries take `ctx`, so a tick cannot scan another floor.
   A previous-turn buffer is derived, not saved, and readable only in its
   owner's tick. Fire walks burning cells, not every row.
   Tests: `fire-burns` (pinned death turn, cause fire); `fear-avoids-fire`;
   spread order-independent; `runs-without-fire`.
5. **Floors, migration, decision LOD.** Several floors, lockstep rounds,
   inbox, `core.travel`, `lodPeriods`. Stairs are entities with a core
   `link {floor, x, y}` component; travel goes both ways through the link.
   A new `explore` module decides migration, fed by hunger through
   contracts (`satiety`).
   Two player actors on different floors drive input and LOD.
   Cached re-execution maps intent key -> action through a Map built at
   registration; an unknown key or an invalid target means "no intent".
   Tests: `migrate-on-famine` (population arrives on floor 1 at
   `t + stairTime`); floor order permuted gives the same hash; restore one
   floor into a live world; replay of (seed, inputs) with two players gives
   the same hash.
6. **Bench.** Reference world and the section 1 budgets. Two-tier floor
   load: a fast path (checksum and structure) for the server's own saves,
   held to the restore budget; full validation for external images, after a
   crash, and in tests.

## 4b. Closing state (after slice 6)

Every section 1 budget is met on the reference world (`bun
bench/reference.ts`, Bun 1.4.3, M5 Pro): world round 57-59 / 59-61 ms,
player floor 3.4 ms, P=64 actor turn 108-113 ns, range scan ~5 µs,
snapshot 88-96 µs (reused buffer; the tightest margin), fast restore
~0.16 ms, floor hash ~70 µs, running RSS ~151 MB. Same seed and permuted floor order give the same hash.

Deviations from the plan as written:
- The tick budget bounds the query range scan. A floor's whole tick phase
  costs ~190 µs, mostly fear, scent and metabolism.
- The restore budget, first 0.15 ms, is 0.2 ms (user decision): the fast
  check, used only on images the server wrote itself, also refuses any
  slot, cell, grid link or stairs link off the floor, so a sealed but wrong
  image cannot corrupt another floor. The full check (~0.4 ms) serves external images,
  crash recovery and tests; it is the default.
- The snapshot budget holds when the caller reuses one buffer per floor.
- The binary heap missed the cached-turn budget (172 ns): the scheduler
  now sorts each round's due actors once, with a heap for in-round
  reschedules.
- `ReadCtx.cellOf`, `approach` and action `requires` were added after the
  freeze, each as a deliberate, pinned edit.
- World generation runs with events off: its spawns have no client.

RSS is the tightest budget: per-call allocation in a hot path shows up as
RSS, not time (an 8-element array per flee cost +60–100 MB).

Open, for world generation (`world/`): spawning compiles the species on
every call, so building 50 floors peaks at ~450 MB RSS (145 MB with a GC
per floor). Generation should compile each species once. Next: export
the World API from `@korr/engine` and host it in `apps/server`.

## 5. Proposed CLAUDE.md changes

- Ids: "Entity ids are `originFloor * 2^25 + counter`: monotonic per origin
  floor, never reused. Storage slots are recycled and never leave a core
  callback."
- RNG: "Every random draw derives from hash(seed, module name, phase, time,
  subject, draw index)."
- LOD: "Every floor runs every system every turn. Creatures re-decide every
  P turns, P set by distance to the nearest player; otherwise they repeat
  their cached action."
- Players: "A player is an actor whose decision comes from a recorded
  input. The engine never waits; the server supplies inputs."
- Health and death are core; other modules change health only through
  `harm`. Containment is core.
- Modules read another module's component only through a getter view typed
  by `contracts/`. Modules keep no state outside registered columns.
- Ties break on stable action keys, never registry order.
- Bulk ticks write only the iterated row or an owned cell column read from
  its previous-turn buffer. The no-per-row-callback rule applies to bulk
  ticks.
- Table rows: `docs/plans/` (plans), `packages/engine/bench/` (benchmarks,
  covered by the size check and determinism lint),
  `packages/engine/src/core/config.ts` (core tuning values).
