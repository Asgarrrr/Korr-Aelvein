# Game loop — scheduler, tick, AI dispatch

The machinery that turns a player action into a world update, runs every
non-player actor scheduled between two player actions, and pins the
determinism contract that backs save/replay.

Built across two phases:

- **Phase 1** (PR #7, `020ebee`) — min-heap scheduler + `WAIT` action.
- **Phase 2** (PR #8, `387c7ae`) — wanderer mob + drain loop + first AI.

> **Scope: single zone.** The multi-zone / living-world rewrite is in
> `docs/LIVING-WORLD.md`. It preserves every invariant below and lifts the
> game loop from "one floor" to "one timeline across many floors".

## Mental model

```
player action  →  tick(state, action)  →  new GameState
                       │
                       ├─ validate action against world
                       ├─ commit action's world mutation
                       ├─ schedule the player's next turn
                       └─ drainNonPlayer:
                            while heap.peek() is not the player:
                              pop event
                              if entity dead → skip (lazy stale skip)
                              else runAi(handle) and reschedule if it acted
```

The scheduler is a **timeline**: one entry per future occurrence of an
actor's turn. After `drainNonPlayer` returns, the heap head is always the
player; the next inbound action is dispatched from that invariant.

## `GameState`

```ts
type GameState = {
  readonly level: Level;
  readonly world: World;            // mutated in place; same reference across ticks
  readonly playerId: EntityHandle;
  readonly scheduler: Scheduler;    // mutated in place; same reference across ticks
  readonly rngState: RngState;      // sfc32 4-tuple
  readonly turn: number;
};
```

Mutation model: **rotating wrapper, stable inner refs.** The `GameState`
literal changes per tick (new `rngState` snapshot, `turn += 1`), but
`state.world` and `state.scheduler` point at the same mutable objects
throughout. Pure-reducer ergonomics on the outside, ECS perf on the inside.

## The scheduler (Phase 1)

Binary min-heap keyed on `(time, seq)`.

```ts
type ScheduledEvent = {
  readonly time: number;          // absolute tick at which this fires
  readonly seq: number;           // insertion order, FIFO tiebreak
  readonly handle: EntityHandle;
};

type Scheduler = {
  heap: ScheduledEvent[];
  now: number;                    // last popped event's time
  nextSeq: number;                // monotonic, never resets
};
```

Public API: `emptyScheduler`, `schedule(s, delay, handle)`, `peek(s)`,
`pop(s)`, `size(s)`. All in `apps/server/src/domain/scheduler/index.ts`.

**Determinism contract.** Starting from `emptyScheduler()`, the sequence of
`schedule` / `pop` calls fully determines the popped event sequence. Ties
on equal `time` are resolved by insertion-order `seq` — owned by the
scheduler itself, **not** derived from `World` column layout — so component
add/remove churn elsewhere cannot reorder turns.

**Why a min-heap and not energy/speed accumulator.** The energy model
(Hauberk, Angband) polls every actor every tick — `O(actors)` regardless of
who acts. It wins only when most actors are perpetually near-ready. We are
going to have NPCs scheduled hours ahead (shop opens at 8h, guard patrol at
midnight) — sparse wakeups dominate, and the heap is strictly better for
that workload. (Audited 2026-05; sources cited in `LIVING-WORLD.md`.)

**Why no decrease-key / no eager removal.** An indexed PQ with decrease-key
wins only when speed mutations are frequent and many; we have none. Eager
removal in a binary heap is `O(n)` — not worth it at our entity scale.

### Stale-handle policy: lazy skip on pop

When an entity is despawned, scheduled events still reference its now-dead
handle (gen parity flipped). `pop` does **not** evict them eagerly — the
caller checks `isLiveHandle(world, handle)` and discards stale entries.
This is the exact policy of flecs and Bevy (generational handles, fallible
getters at consumption time).

`pop` always advances `scheduler.now` to the popped event's `time`, **even
when the event is stale**. Game-time advances regardless of who's alive — a
chain of stale entries between two live events steps `now` through every
intermediate stale time.

### Multi-action turns fall out for free

Re-schedule the same handle twice with smaller delays:

```ts
schedule(scheduler, 30, handle); // fast attack
schedule(scheduler, 30, handle); // follow-up
```

Both pop before another actor at delay ≥ 60 gets a slot. No special case in
the heap.

## The tick reducer (Phase 2)

`tick(state, action)` lives in `apps/server/src/domain/game/tick.ts`. Three
action variants today:

```ts
type Action =
  | { readonly type: "MOVE"; readonly dir: "n" | "e" | "s" | "w" }
  | { readonly type: "WAIT" }
  | { readonly type: "ENTER_ZONE"; readonly zone: ZoneId };

const ACTION_COST = 100; // 1 "turn" = 100 ticks; speed variants land as smaller / larger costs
```

`ENTER_ZONE` is the only action that rotates `state.activeZone` and
`state.playerId`. Its semantics — park the current zone, concretize the
target, teleport the player — live in `game/zones/transition.ts`; see
`docs/LIVING-WORLD.md` § "Zone transitions (Phase 6)" for the contract.

Algorithm:

1. Assert `playerId` is live and the heap head is the player. Both errors
   mean the caller corrupted the invariant — throw, don't paper over.
2. Hydrate `rng = fromRngState(state.rngState)` once for the whole tick.
   Persist `rng.state()` back to `GameState` at the end even when no rolls
   fired — fresh tuple identity, value-equal when nothing rolled. Single
   source of truth, no "did the rng roll?" branch.
3. Resolve the action:
   - `MOVE`: validate bounds → wall → occupancy (`entityAt`). On
     refusal, return `state` by reference. **No `pop`, no reschedule, no
     turn cost.**
   - `WAIT`: always accepted.
4. On acceptance: `pop` the player, mutate world, `schedule(scheduler,
   ACTION_COST, playerId)`.
5. `drainNonPlayer(state, rng)` until the heap head is the player again.
6. Return `{ ...state, rngState: rng.state(), turn: turn + 1 }`.

**The refused-action contract.** Refused inputs return the same `state`
reference. The WS layer can `===`-compare and skip the push when nothing
changed. The contract is structural — there is no path through `tick`
where a refused action mutates `world`, `scheduler`, or `rngState`.

## The drain loop

```ts
function drainNonPlayer(state: GameState, rng: Rng): void {
  while (true) {
    const next = peek(state.scheduler);
    if (next === undefined) return;
    if (sameHandle(next.handle, state.playerId)) return;
    pop(state.scheduler);
    if (!isLiveHandle(state.world, next.handle)) continue;
    const acted = runAi(state, rng, next.handle);
    if (acted) schedule(state.scheduler, ACTION_COST, next.handle);
  }
}
```

Three properties guaranteed:

- **Player-head invariant** — re-established before every tick returns.
  Inbound actions always dispatch from "player on top".
- **Stale handles skip lazily** — `pop` advances `now`, the handle is
  discarded, the loop continues.
- **No zombie reschedule** — `runAi` returns `boolean`. An entity whose
  `ai` was stripped (despawn race, future status effects like *paralyzed*)
  drops out of the heap instead of cycling forever.

## AI dispatch (`game/creatures/ai.ts`)

`runAi` is a `switch(ai.kind)` with a `never` exhaustiveness sentinel:

```ts
type Ai = { readonly kind: "wanderer" }; // extended as new kinds land

switch (ai.kind) {
  case "wanderer":
    runWanderer(state, rng, handle);
    return true;
  default: {
    const _exhaustive: never = ai.kind; // compile error when a new variant lands
    throw new Error(`runAi: unhandled ai kind ${_exhaustive}`);
  }
}
```

Adding a new variant without a handler is a compile error. Per the 2026
audit, this is the right call for our scale: column-store TS,
single-threaded, ≤100 entities per zone. The marker-component-per-kind
pattern (Bevy / flecs canonical) wins only with archetype storage and
cache-blocked iteration — neither applies here.

`runWanderer` rolls `rng.int(0, 3)` for a cardinal direction, refuses
out-of-bounds / walls / occupied cells, mutates position on success. A
wanderer without a `position` is a defensive no-op (silent skip).

## Occupancy

`entityAt(world, x, y)` in `state.ts` iterates `query(["position",
"actor"])` and returns the first matching handle, or `undefined` if the
cell is free. `O(n)` per call.

The 2026 audit found this fine below ~1000 actors. Per-zone we sit at
≤100. The migration trigger is **either** per-zone actor count ≥ ~500
**or** Phase 5 bump-combat profile data showing the scan is hot — the
planned swap is a `Map<cellKey, EntityHandle>` maintained in
`setComponent("position")`.

The "one actor per tile" invariant becomes a bump-combat trigger as of
Phase 5: the player's MOVE branch attacks the occupant instead of
refusing, and a wanderer that rolls into the player's tile attacks
instead of stepping. Wanderer-vs-wanderer still refuses (no factions yet).
Combat lives in `game/creatures/combat.ts` (`attack(world, rng, target) → {damage,
killed}`); `gameOver` is computed at end of each tick from the player's
HP and surfaced through the WS snapshot.

## RNG threading

```ts
const rng = fromRngState(state.rngState);
// reducers / drain may call rng.int / rng.pick / rng.chance
return { ...state, rngState: rng.state(), turn: turn + 1 };
```

One hydration, one persistence, threaded through the whole tick.
Determinism contract for replay: same `(seed, action sequence)` produces a
byte-identical `GameState` sequence.

## Tests pinning all of the above

- `apps/server/src/domain/scheduler/tests/properties.test.ts` — 5k-op
  cross-check against a sorted-array reference, ties-heavy stress,
  sort-and-drain, pure-tiebreak, `nextSeq` parity, empty-pop invariance.
- `apps/server/src/domain/scheduler/tests/index.test.ts` — surface-level
  unit coverage of `emptyScheduler` / `schedule` / `peek` / `pop` / `size`.
- `apps/server/src/domain/game/tests/tick.test.ts` — `WAIT`, `MOVE`
  accept/refuse, refused-action returns the same reference, `rngState`
  advance/preservation.
- `apps/server/src/domain/game/tests/wanderer.test.ts` — spawn count +
  uniqueness, seq-tiebreak (player acts first), drain semantics,
  determinism across seeds and dungeon styles, `rngState` advance,
  stale-handle lazy skip, no-zombie reschedule, occupancy refusal (player
  bump + two-wanderer non-collision over 50 turns).

## Trade-offs accepted

- **`O(n)` `entityAt`** — fine per-zone at our scale; migration only
  on confirmed hot path.
- **Single RNG stream** — every roll across every actor consumes the same
  stream in heap order. Solo + serial tick + `(time, seq)` total ordering
  = deterministic replay. Splitting per-actor adds bookkeeping for no win.
- **Persisted `rngState` even on no-op tick** — one tuple alloc, removes a
  "did the rng roll?" branch, single source of truth.

## Alternatives rejected

| Alternative | Why not |
|---|---|
| Energy/speed accumulator (Hauberk, Angband) | `O(actors)` per tick; loses to heap on sparse wakeups |
| Indexed PQ with decrease-key | Speed mutations are not frequent at our scale |
| Marker-component-per-kind AI dispatch | Wins only with archetype-cache-blocked iteration |
| `Uint32Array(width × height)` occupancy index | Premature; planned only on confirmed hot path |
| Eager stale-event eviction on despawn | `O(n)` in a binary heap; lazy skip on pop is the SOTA |
