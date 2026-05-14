# `domain/ecs`

Sparse-set ECS for the server tick loop. TypeScript strict, no-`as` / no-`!`, deterministic across runs.

> Conventions and deliberate non-features (relations, archetypes/groups, lifecycle hooks): see `docs/MAP.md` § "ECS conventions". Read the revisit criteria before proposing any of them.

## Invariants

- **Storage** — one sparse-set column per component (`dense: {id, v}[]` + `Map<EntityId, number>` sparse index).
- **Mutation** — in place during a tick. `state.world` is the same reference before and after; the immutability boundary is the tick, not each op.
- **Liveness** — parity-encoded in the generation counter. Even gen ⇒ live, odd gen ⇒ slot ready for reuse. No separate `live` set, no ghost-handle window.
- **Iteration order** — dense insertion order with swap-and-pop on despawn. Stable given the same op sequence.
- **Components stored by value** — `spawn` / `setComponent` clone each component field-by-field at the public boundary; mutating the caller's input post-call cannot reach into the world. Symmetric on the way out: `snapshot()` clones too.
- **Boundary validation** — `spawn` / `setComponent` / `restore` reject non-finite numeric fields (NaN / Infinity round-trip to `null` through JSON and would corrupt the column). `restore` rejects generation values outside `[0, 2^31)`.
- **Snapshot** — `snapshot(world)` / `restore(s)` round-trip byte-equal; same op sequence on two fresh worlds ⇒ equal snapshots.
- **`World` is structural-trusted** — exported as a structural type for ergonomics (`state.world: World` is the visible shape), but the internal arrays / maps remain mutable for `setInColumn` / `removeFromColumn` to do their work. Treat it as opaque: write through the public API only. Direct mutation (`w.recycled.push(...)`, `w.position.dense.pop()`) corrupts invariants — guarded by convention, not the type system.

## API

```ts
import {
  emptyWorld, spawn, despawn, isLiveHandle,
  getComponent, setComponent, removeComponent,
  query, queryFiltered, forQuery, forQueryFiltered, type QueryOpts,
  drainEntered, drainExited,
  defineEvent, emit, drain, type EventChannel,
  snapshot, restore, type SerializableWorld,
  runSystems, type System, type SystemCtx,
} from "./domain/ecs";
```

Adding a component = field in `Components` (`components.ts`) + slot in each per-key dispatch table in `world.ts`. TS errors keep the two ends in sync.

## Usage

```ts
// Spawn — fresh handle, generation 0.
const w = emptyWorld();
const player = spawn(w, {
  position: { x: 5, y: 3 },
  actor: { glyph: "@", name: "you" },
  hp: { current: 10, max: 10 },
});

// Mutate by component, in place.
setComponent(w, player, "position", { x: 6, y: 3 });

// Read — undefined if the entity is stale OR missing the component.
const pos = getComponent(w, player, "position");
```

```ts
// Batch processing: forQuery (push, zero-alloc, ~50% faster than query).
forQuery(w, ["position"], (h, e) => {
  setComponent(w, h, "position", { x: e.position.x + 1, y: e.position.y });
});

// Find-first: query (pull, generator, native break).
for (const [h, e] of query(w, ["position", "hp"])) {
  if (e.position.x === targetX && e.position.y === targetY) {
    setComponent(w, h, "hp", { current: e.hp.current - 1, max: e.hp.max });
    break;
  }
}

// Collect: query yields fresh refs per entity, safe to retain.
const lowHp: EntityHandle[] = [];
for (const [h, e] of query(w, ["hp"])) {
  if (e.hp.current <= 3) lowHp.push(h);
}

// Filters: with / without. Use the `*Filtered` variant. Filters are
// evaluated AFTER pivot + liveness, BEFORE projection — pivot stays
// smallest-of-`keys`, never expanded by `with`. The unfiltered and
// filtered paths are separate functions so each call site stays
// monomorphic (V8 inline caches were measurably hot when the filter
// argument made one function bi-shaped — see `query.ts` head comment).
for (const [h, e] of queryFiltered(w, ["position"], { without: ["dead"] })) {
  // every live position-bearing entity that isn't tagged dead
}
forQueryFiltered(w, ["position"], { with: ["hp"] }, (h, e) => {
  // only entities carrying both position and hp (hp not projected)
});
```

`forQuery` reuses one `handle` + one `view` across calls. The callback contract:

- **Don't retain references** to `handle` or `view` past the callback's return — they'll be overwritten in the next invocation.
- **Don't mutate `view`** (no `view.hp = ...`, no `Object.assign(view, ...)`). The runtime "view exposes only the requested keys" claim depends on the callback not adding keys.
- **Don't pass `view` to async code.** By the time the promise resolves, the references are stale.

If you need any of those, copy what you need (`{...view}`, `{...handle}`) and work with the copy, or use the `query` generator which yields fresh objects.

## Event channels (`defineEvent` / `emit` / `drain`)

For events that are not "entity gained/lost a component" — combat hits, deaths, level-up, doors opening. Channels are defined once with a typed payload and routed through the world's event bus.

```ts
const Hit = defineEvent<{ targetId: EntityId; damage: number }>("hit");
const Death = defineEvent<{ entityId: EntityId; killer: EntityId | null }>("death");

// Inside any system:
emit(w, Hit, { targetId: t, damage: 5 });

// Later system drains and reacts:
for (const ev of drain(w, Hit)) {
  // apply damage, etc.
}
```

Contract:
- **Channel identity is the name.** Two `defineEvent("hit")` calls share the same bucket — useful for cross-module shared channels, dangerous if `T` differs (the typed boundary protects each call site but not across modules with conflicting `T`).
- **Channel names should be static module-level constants.** Dynamic names (`defineEvent("hit_" + id)`) accumulate Map entries even after draining; prefer a payload field over a per-instance channel.
- **Drain returns a fresh array, clears the bucket, deletes the Map entry, preserves emit order.**
- **Snapshot/restore round-trips un-drained events byte-equal.** Empty channels are dropped from the snapshot (drained channels take zero serialized space).
- **No callbacks, no `onAdd`/`onRemove` hooks.** Lifecycle hooks would break the pure-reducer model `(state, action) → state` and introduce reentrancy hazards. Use lifecycle buffers + event channels — both polled, both deterministic.

Cost: ~1 `Map.get` + `Array.push` per emit. Drain allocates one array.

## Lifecycle buffers (`drainEntered` / `drainExited`)

Per-component append log of "entity gained this key" (`added`) and "entity lost this key" (`removed`) since last drain. Systems own their timing — no auto-clear at tick boundary, no callbacks.

Drains return `EntityHandle[]` (not bare ids): each handle carries the gen captured at push time. If the slot is despawned-recycled between push and drain, the captured gen mismatches the world's live gen and `isLiveHandle` rejects the stale handle — same defense as ghost-handle rejection in queries.

```ts
// During a tick, AI sees fresh enemies and dead enemies via lifecycle drains.
for (const h of drainEntered(w, "actor")) {
  if (!isLiveHandle(w, h)) continue; // stale (despawn-recycled mid-tick)
  // entity h gained an actor component this tick (spawn or set)
}
for (const h of drainExited(w, "hp")) {
  // h carries the pre-bump (live) gen — `isLiveHandle` returns false now,
  // which is the signal that the entity lost its hp this tick.
}
```

Contract:
- **`spawn`** pushes to `added[k]` for every bound key, with the fresh handle.
- **`setComponent`** pushes to `added[k]` only on absent→present transitions. Re-writes (moving an entity each tick) do NOT push.
- **`removeComponent`** pushes to `removed[k]` only if the key was bound.
- **`despawn`** pushes to `removed[k]` for every column the entity still holds, with the pre-bump (live) gen.
- **Drain** returns a fresh array (caller mutation safe), clears the buffer, preserves insertion order.
- **Snapshot/restore** round-trips pending events byte-equal — restoring a snapshot does NOT regenerate enter events for the populated columns.

Cost: ~3 ns per `set`/`remove` (one `sparse.has` check + conditional `array.push`). Batch update of 5 000 in-place writes: +3.6 % vs no buffers.

## Filter semantics (`with` / `without`)

- **Post-filters**, evaluated per entity in the iteration loop. `O(|with| + |without|)` extra cost per pivot entry — each check is a `sparse.has()`, ~2 ns.
- **Pivot is locked to smallest-of-`keys`.** Adding `with: ["hp"]` to a `keys: ["position"]` query does NOT pull `hp` into pivot consideration — iteration order stays predictable from the matched set.
- **Order**: `without` is checked before `with` (cheap reject if any without-key matches).
- **Empty `with: []` / `without: []` are no-ops.** Useful when a system computes the filter list dynamically.
- **Bench**: `forQueryFiltered[position] with[hp]` @5000 = 71 µs vs unfiltered `forQuery[position]` 60 µs (+18%, one `sparse.has` per pivot entry).

## Iteration semantics under mid-iter mutation

Both `query` and `forQuery` snapshot the **pivot column's `(id, gen)` pairs upfront** (SoA). The pivot is the smallest matching column.

- **Pivot membership is pinned at snapshot time.** An entity that gains the pivot component mid-iter is NOT yielded during this iteration — it wasn't in the snapshot.
- **Secondary keys are read live at yield time.** An entity in the pivot snapshot that gains a missing secondary mid-iter (via an earlier callback) IS yielded when the loop reaches it.
- **Despawn during iter is safe.** The pivot snapshot's gen pair fails the parity / equality check at the dead slot's slot — yield is skipped.
- **Despawn-then-respawn (same slot) is safe.** The impostor's new gen mismatches the snapshot's pinned gen — yield is skipped.

Tests `query.test.ts` / `forquery.test.ts` lock all four cases; if you change snapshot semantics, those tests fail loudly.

## Performance

`bun run bench:ecs` from `apps/server/` (sources in `bench/`). For stable claims, `bun run bench:ecs:agg` aggregates 100 runs of standard + mega and writes `bench/results.json` with min/mean/median/p95/max/stdev per scenario. Numbers below are 100-run medians on Apple Silicon (M5 Pro) + Bun 1.3.12, CV ≤ 1.4% at N=5000.

N=5000, single-component pivot:

| | µs/op | ops/s |
|---|---:|---:|
| `query[position]` — iterate | 120 | 8 300 |
| `forQuery[position]` — iterate | **60** | **16 700** |
| `forQueryFiltered[position] with[hp]` — iterate | 71 | 14 000 |
| `query[position]` — batch update | 166 | 6 000 |
| `forQuery[position]` — batch update | **105** | **9 500** |

`bench:ecs:mega` at N=100 000: `query` iter 4.10 ms → `forQuery` **2.74 ms (−33%)**, `query` batch 5.54 ms → `forQuery` **3.39 ms (−39%)**. `forQuery`'s zero-alloc-per-entity offsets the projection cost that grows linearly with N.

### Find-first crossover (`bench:ecs:find-first`)

N=5000, target at varying positions. `query` uses `break`, `forQuery` uses a `found` flag (callback returns early but the loop still scans):

| Target position | `query` µs | `forQuery` µs | Winner |
|---|---:|---:|---|
| idx 0 (first) | **16** | 56 | `query` 3.6× |
| idx 1250 (Q1) | **42** | 58 | `query` 1.4× |
| idx 2500 (mid) | 69 | **60** | `forQuery` +13% |
| idx 3750 (Q3) | 95 | **62** | `forQuery` +35% |
| idx 4999 (last) | 122 | **65** | `forQuery` +47% |
| miss | 122 | **65** | `forQuery` +47% |

The crossover sits around 30-40% into the pivot column. `query` wins anywhere break exits early (AI target-acquisition for a nearby foe); `forQuery` wins on full scans even with the flag workaround because its zero-alloc-per-entity offsets the missing break. Both APIs earn their keep.

`spawn` (~85 ns/op at N=5000, ~115 ns at N=100k) and `setComponent` (~9 ns/op, all scales) are sub-100 ns ops where the bench can't fully isolate timer + GC noise. `results.json` reports them with their full distribution; don't quote them as headline numbers.

## Determinism

5 canary scenarios (500 random ops, seeds `0/1/7/42/99`) are FNV-1a-hashed and pinned in `tests/determinism-locked.test.ts`. **Hash drift = STOP** — either intentional (regenerate pins in the same commit, explain) or a real bug.

100-seed distribution check verifies ≥ 95 distinct hashes (no collision).

## Tests

`bun test` covers world / query / forQuery / system / determinism (79 tests). `bun run test:stress` adds 7 opt-in stress tests (1 M spawn-despawn cycles, 100k-entity query, etc.).

## Bench-rejected patterns (don't re-try)

| Pattern | Bench result | Why |
|---|---|---|
| `live: Set<EntityId>` for liveness | — | Replaced by parity encoding: one fewer `Map.get` per `isLiveHandle`, smaller snapshot, same ghost-handle defense. |
| `{id, gen}[]` snapshot | — | Replaced by SoA `(ids[], gens[])`: zero per-entity object allocs. |
| Distinct `projectKeys` and `fillView` helpers | — | Same logic — deduplicated through the type-predicate variant. |
| `for (const [dx, dy] of DIRS)` instead of `for k=0..3` | 2.2-2.4× slower | Iterator + destructure overhead in hot BFS loops. |
| `visit()` closure for BFS neighbour expansion | 3.7× slower | Closure boxes the mutable tail counter. |
| `assertDefined<T>(x: T \| undefined): T` helper | 14% slower | Function call on the hot path can't be inlined past the throw. |
