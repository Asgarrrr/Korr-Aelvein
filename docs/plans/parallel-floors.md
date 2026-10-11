# Design: parallel floors

First step of the performance phase. Brainstormed with the user on
2026-10-11, informed by a crate survey (researcher) and a prior-art review
(advisor). Active-tile skipping, fused walks and per-system tick rates come
after, driven by the bench this step adds.

## User decisions

- Every floor of the world is simulated every round. The budget is per
  floor; the number of floors follows from the hardware.
- Budget 500 creatures per floor, stress at 1k. 2k is not a game need.
- Parallelism first. Threads live in `host/`, never in `sim/`.

## Why it is safe

Phase 1 of a round (environment, then actors) shares no mutable state
between floors. `Floor` is `Send`. The closure sees only `Seed`,
`&Ruleset` and `&M`. Each floor draws from its own streams, so no result
depends on the thread count. `sim/clippy.toml` bans `Cell` and atomics.
The barrier (send, inbox, land, end of round) stays serial, and the inbox
is ordered, so floor order never changes a result.

## 1. Components

`korr-core` stays `no_std` and thread-free.

| Item | Role |
|---|---|
| `trait Runner { fn each<F: Fn(&mut Floor) + Sync + Send>(&self, floors: &mut [Floor], f: F); }` | Runs phase 1 on every floor. Exported through `korr_core::host`. |
| `Sequential` | The core impl: a plain loop. |
| `World::run_round` | Takes a runner for phase 1. The barrier code does not change. |
| `Game::run_round(world)` | Unchanged signature, uses `Sequential`. Existing callers do not change. |
| `Game::run_round_on(world, runner)` | Requires `M: Sync`. |

`F` needs `Send` as well as `Sync`: rayon's `for_each` requires both, and
an impl cannot add bounds the trait leaves out.

`host/server` gains a `lib` target with `Threads`: a `Runner` over an owned
`rayon::ThreadPool` (rayon 1.12), never the global pool.

```rust
pool.install(|| floors.par_iter_mut().with_max_len(1).panic_fuse().for_each(f))
```

- `with_max_len(1)` makes each floor one stealable job. Without it, rayon
  splits the slice into about one leaf per thread and runs each leaf to the
  end, so a leaf of heavy floors becomes a straggler.
- The thread count is a constructor argument. Size it below the core count
  to leave room for tokio. No pinning: macOS refuses thread affinity, and
  QoS classes need `unsafe`, which the workspace forbids.
- One pool per process, shared later by every world it hosts.

## 2. Data flow

The simulation thread calls `run_round_on`. It is a dedicated thread, never
a tokio task: `install` blocks until every floor is done. Then the serial
barrier runs. Tokio talks to the simulation thread through channels; that
wiring comes with the server.

## 3. Errors

A panic in one floor reaches the caller of `install`. `panic_fuse` stops the
other floors early, but the world is left half-advanced. Rule: a panic
during a round is fatal for that world; the server reloads a save. The
server does not exist yet, so this phase only records the rule.

## 4. Tests and bench

Written before the code, and seen failing first.

- `sim/scenarios`: a test runner `Reversed` walks floors back to front.
  Several floors, actors changing floor, K rounds: same hash as
  `Sequential`. It proves floor order does not matter, without threads.
- `host/server/tests`: the same scenario with `Threads` at 1, 2, 3 and N
  threads gives the hash of `Sequential`.
- Bench in `host/tools/ecs-bench/benches/core.rs`: M floors of 128x128,
  wander and flora, about 500 actors per floor.
  - Median round time and efficiency T1 / (N × TN) for 1 to N threads.
  - The same curve with a trivial tick. If it flattens first, memory
    bandwidth is the limit (estimated at about 1.4 GB/s per core, so
    probably not).
  - Skewed floors (10% of floors cost 2 ms, side by side): default
    splitting against `with_max_len(1)`.
  - The barrier's share of the round.

The bench gives the per-floor budget input:
floors per round = 50 ms × cores × efficiency / cost per floor.

## Out of scope

- Parallel barrier: `send` and `land` work per floor and can go through the
  same runner, after flight routing uses a `FloorId` to index lookup
  instead of a linear `find`. Goes to `docs/ideas.md`.
- False sharing between neighbouring `Floor`s (inline `Vec` headers written
  every turn): measure only if the curve shows it; fixes are
  `Vec<Box<Floor>>` or 128-byte alignment.
- `docs/plans/perf-budget.md`, active tiles, fused walks, tick rates.

## Sources

- https://docs.rs/rayon/1.12.0/rayon/struct.ThreadPool.html
- https://docs.rs/rayon/1.12.0/rayon/iter/trait.IndexedParallelIterator.html
- https://docs.rs/tokio/latest/tokio/task/fn.spawn_blocking.html
- https://www.factorio.com/blog/post/fff-415
- https://github.com/rayon-rs/rayon/issues/642
- https://github.com/rui314/mold/pull/1694
