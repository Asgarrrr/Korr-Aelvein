# `domain/scheduler`

Binary min-heap turn scheduler keyed on `(time, seq)`. Generic over the payload — Phase 1/2 used `EntityHandle`, Phase 3+ uses `GlobalEvent` so the same heap carries actor turns, dormant-zone schedule events, and (future) world events on a single timeline.

> Deep-dive: `docs/GAME-LOOP.md` § "The scheduler" (single-zone) and `docs/LIVING-WORLD.md` § "Zone transitions (Phase 6)" (heap invariants under park/concretize).

## API

```ts
import {
  emptyScheduler,    // <T>() → Scheduler<T>
  schedule,          // <T>(s, delay: number, payload: T) → void   (relative)
  scheduleAt,        // <T>(s, time: number, payload: T) → void    (absolute)
  peek,              // <T>(s) → ScheduledEvent<T> | undefined
  pop,               // <T>(s) → ScheduledEvent<T> | undefined
  size,              // <T>(s) → number
  removeWhere,       // <T>(s, pred: (ev) => boolean) → void
  type Scheduler,
  type ScheduledEvent,
} from "./domain/scheduler";
```

```ts
type ScheduledEvent<T> = {
  readonly time: number;   // absolute tick at which this fires
  readonly seq: number;    // insertion order, FIFO tiebreak on equal time
  readonly payload: T;
};
```

## Invariants

- **Min-heap on `(time, seq)`.** Smaller time wins; ties on equal time resolved by smaller `seq`. `seq` is owned by the scheduler (`nextSeq` counter, monotonic, never resets) — not derived from any external storage layout, so churn elsewhere cannot reorder turns.
- **Mutation model.** `Scheduler<T>` is mutated in place. The surrounding `GameState` wrapper rotates per tick; the scheduler reference stays stable.
- **`pop` advances `now` to the popped event's `time`** — even when the caller decides to discard the popped event (stale entity handle, dropped variant). Game-time advances regardless of who's alive; drain loops must loop on `pop` + a liveness check rather than peeking.
- **`schedule(s, delay, payload)`** adds at `s.now + delay`. **`scheduleAt(s, time, payload)`** adds at the exact `time`, throwing if `time < s.now` (events never fire in the past).
- **`removeWhere(s, pred)`** filters the heap in place and re-heapifies bottom-up (Floyd's algorithm, `O(n)`). Used by Phase 6 zone transitions as a one-shot batch delete; the alternative would be lazy-skip on pop, which would accumulate dropped events forever.

## Stale-handle policy: lazy skip on pop

When a payload references something that has since died (e.g. a despawned entity), the caller checks at `pop` time and discards. Eager removal would be `O(n)` in a binary heap and isn't worth it at our entity scale.

```ts
while (true) {
  const ev = pop(scheduler);
  if (ev === undefined) break;
  if (!isLiveHandle(world, ev.payload)) continue;  // stale, skip
  // ... dispatch ev.payload ...
}
```

`pop` still advances `now` past stale entries — a chain of stale entries between two live events steps `now` through every intermediate time.

This is the exact policy flecs and Bevy use for generational handles + fallible getters at consumption time.

## Determinism contract

Starting from `emptyScheduler()`, the sequence of `schedule` / `scheduleAt` / `pop` / `removeWhere` calls fully determines the popped event sequence. `removeWhere` filters in place — survivors keep their original `seq`, so a subsequent `schedule` issues fresh seqs without conflict.

## Why a min-heap

Phase 1+ NPCs are scheduled hours of game-time in the future (shop opens at dawn, patrol arrives at point P at T+5h). Sparse wakeups dominate, the heap is strictly better than an energy/speed accumulator for that workload.

| Alternative | Why not |
|---|---|
| **Energy/speed accumulator (Hauberk, Angband)** | `O(actors)` per tick regardless of who acts. Wins only when most actors are perpetually near-ready. Loses to the heap on sparse wakeups. |
| **Indexed PQ with decrease-key** | Wins only when speed-mutation events are frequent; we have none. |
| **Hashed timing wheel** | Optimised for high-frequency uniform-delay events (network I/O). Our timeline is irregular. |
| **Eager stale-event eviction on despawn** | `O(n)` in a binary heap. Lazy skip on pop is the SOTA. |

## Multi-action turns

Re-schedule the same handle twice with smaller delays:

```ts
schedule(scheduler, 30, handle);  // fast attack
schedule(scheduler, 30, handle);  // follow-up
```

Both pop before another actor at delay ≥ 60 gets a slot. No special case in the heap.

## Performance

`bun run bench:scheduler` (single-run) and `bun run bench:scheduler:agg` (30-run aggregate, median + p95 + CV) from `apps/server/`. Numbers below are 30-run medians on Apple Silicon + Bun 1.3.12, CV ≤ 6 % on every scenario.

| Scenario | N=50 | N=500 | N=5000 |
|---|---:|---:|---:|
| `schedule+pop` cycle (heap stays at N) | 46 ns | 54 ns | 83 ns |
| `peek` | 1.4 ns | 3.4 ns | 2.3 ns |
| `drain N` (schedule N then pop N) | 1.4 µs | 19 µs | 310 µs |
| `removeWhere` @ 50 % match | 458 ns | 5.6 µs | 56 µs |

Two optimizations land on top of the textbook binary-heap layout — measured against a per-variant baseline in `bench/variants.bench.ts`, kept only because the aggregate ran them inside the noise floor (CV-bracketed):

- **Inlined `(time, seq)` comparator** in `bubbleUp` / `bubbleDown`. A free `lessThan` helper was readable but V8 didn't reliably inline it across the hot path. Floyd heapify after `removeWhere` calls `bubbleDown` N/2 times, so every saved call counts — the inline form lands `removeWhere @ N=5000` ~20 % under the helper-call baseline.
- **In-place compact in `removeWhere`** instead of "build a new survivor array, reassign `s.heap`". Skips both the allocation and the per-survivor `Array.push` resize check. Independently worth −12 to −15 % at N=5000, compounds with the inlined comparator.

### Bench-rejected patterns (don't re-try)

| Pattern | Bench result | Why |
|---|---|---|
| SoA storage (parallel `times[]` / `seqs[]` / `payloads[]`) | `schedule+pop` cycle +13 % SLOWER @ N=500 | 3× write cost on every heap swap. Cache-friendliness on linear scans didn't compensate at our scale. Revisit only if heap regularly exceeds N=10 000 AND profile shows the AoS push as dominant alloc. |
| Inlined comparator alone (without in-place compact) | Marginal everywhere on cycle / drain | Wins only on `removeWhere` because Floyd compounds it. Kept paired with in-place compact in the adopted version. |
| Drop the helper-call comparator without inlining | — | Would gain readability but the bench shows the inline form costs the same in `bubbleUp` (one comparison per iter) and pays back in `bubbleDown` × Floyd. Net: inline is the better trade. |

## Tests

- `tests/index.test.ts` — surface-level coverage of every export, plus `scheduleAt` time validation and `removeWhere` heap-order preservation.
- `tests/properties.test.ts` — 5 000-op cross-check against a sorted-array reference, ties-heavy stress, sort-and-drain, pure-tiebreak, `nextSeq` parity, empty-pop invariance.

Run with `bun test src/domain/scheduler`.
