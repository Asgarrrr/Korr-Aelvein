# Korr Aelvein

A turn-based, server-authoritative roguelike. An island built around an inexplicable abyss whose presence shapes the world without anyone knowing why. Descend, die, descend again — and inherit what the last one wrote down.

The world lives in [`registry/`](registry/). The engine lives here.

```
##########......###............................###@.......................######
########.........................................###...................#########
#######.......................###................####..............#############
######......######...........######..............####.............##############
###........########.........#########............####.............##############
##........#########........#############.........#####............##############
##.......#########.........#############..###.....####............##############
##.......#######...........########..###.#####................##.###############
##......#######............#######........#####..............###################
##...#########..............#####.........####......##.......#############...###
###.##########..............####.........###.......####......#############.#####
##############..............####........###.......######....##############.#####
##############.....###......#####......####......##################..####..#####
#############...######.......#######..#####......#################...###.....###
#############..#######........############.......################.............##
#####>....##..########.........######............##..####..#####..............##
```
<sub>`bun run preview --style caverns --seed 7` — pure-pass cellular-automata pipeline, ~2 ms at 300×150, byte-deterministic from the seed.</sub>

---

## What earns its keep

### Server is the only source of truth

WebSocket only, one `/game` endpoint, one TypeBox schema per inbound message. The client is a renderer + input forwarder — no game logic, no prediction, no rollback. `if (canMove(...))` in `apps/client/src/` is a code smell; `Math.random()` is a bug.

### Determinism is a load-bearing contract

A seed and an action sequence produce a byte-identical `GameState` sequence. The custom **sfc32 PRNG** (128-bit state, pure 32-bit JS arithmetic, identical sequence across V8/Bun and any modern browser) snapshots into a `[i32, i32, i32, i32]` tuple that lives in `state.rngState`. Reducers hydrate at the top of a tick, thread through, persist back — `(state, action) → state` stays value-semantic while the internal state mutates allocation-free.

Pinned by **FNV-1a hashes of 200-seed runs** across the dungeon generators and a 5-canary ECS regression suite. Hash drift = **STOP**.

### Custom sparse-set ECS, no library

| Op | N=5000 | N=100 000 |
|---|---:|---:|
| `forQuery[position]` iterate | 60 µs | 2.74 ms |
| `forQuery[position]` batch update | 105 µs | 3.39 ms |
| `forQueryFiltered[position] with[hp]` | 71 µs | — |
| `spawn` | ~85 ns/op | ~115 ns/op |
| `setComponent` | ~9 ns/op | ~9 ns/op |

<sub>100-run medians, Apple Silicon (M5 Pro) + Bun 1.3.12, CV ≤ 1.4 % at N=5000.</sub>

One sparse-set column per component, **parity-encoded liveness** (no separate `live` set, no ghost-handle window), lifecycle buffers + typed event channels instead of `onAdd`/`onRemove` callbacks (no reentrancy hazards). bitecs / miniplex / koota / flecs-style archetypes were audited and rejected with explicit revisit criteria — [`apps/server/src/domain/ecs/README.md`](apps/server/src/domain/ecs/README.md) documents the picks and the rejected patterns.

### Multi-zone living world

Caves-of-Qud-style reality bubble: one zone is `active` (fine-grain AI at action granularity), every other zone is `dormant` (its NPCs deposit events on a single global `(time, seq)` min-heap and advance via pure abstract resolvers).

Zone transitions are atomic — `parkActiveZone` converts in-flight actor turns to schedule events; `concretize` catches up due events before flipping the discriminator. Full simulation everywhere (Dwarf Fortress) and CDDA's freeze-and-thaw were both considered and rejected; the 2026-05 audit with sources lives in [`docs/LIVING-WORLD.md`](docs/LIVING-WORLD.md).

### Pure-pass procgen

Each dungeon style is a `ReadonlyArray<(Level, Rng) → Level>` recipe. Adding a style is a folder under `styles/` plus one line in the dispatch table.

| Style | Aesthetic | Perf @ 300×150 |
|---|---|---:|
| `rim` | Brogue-style room accretion | ~0.03 ms |
| `caverns` | Cellular-automata caves | ~2 ms |

No async, no mutation-as-API, no library — every randomness call flows through the injected `Rng`.

### TypeScript with deliberate ergonomics

`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`, `noImplicitReturns`, `noPropertyAccessFromIndexSignature` — all on.

**No `as` (any form, including `as const` and import-rename `import { X as Y }`), no `!` non-null assertion.** Both lie to the type system; the project refactors with `for…of` + `entries()`, runtime guards, or explicit annotations instead. Not yet lint-enforceable — respected on every edit, caught at review. The `rng.pick` op is O(n) (~36.5 ns/op for 10-element arrays) precisely because the rule forbids `arr[idx]` without a runtime guard. We measured the cost; we kept the rule. The single carve-out: a branded-type factory in a `brands.ts` may use one `as` to construct the brand (`return n as ZoneId`) — the one widening TS can't express, provably safe and confined to that file.

### End-to-end types over WebSocket

**Eden Treaty** pulls `type App` from `apps/server/src/index.ts` via Bun's workspace symlink — the client never redeclares WS message types. Schema, runtime validation, and TS type all derive from the same TypeBox literal (`typeof schema.static`); they cannot drift.

### One tool per job, no debates

**Biome 2** handles lint + format + import-sort from a single root `biome.json`. No ESLint, no Prettier. **`bun:test`** as the runner — no Jest, no Vitest.

```
1421 pass · 7 skip · 0 fail · 263 011 expect() calls
Ran 1428 tests across 46 files in 537 ms
```

---

## Architecture at a glance

```
apps/
  server/                       Bun + Elysia. WS /game, HTTP /health.
    src/
      app.ts                    createApp() — pure Elysia builder, used by tests too.
      index.ts                  createApp().listen(PORT), re-exports type App.
      domain/                   The substance. Each folder ships its own README.
        rng/                    sfc32, serialisable state.
        scheduler/              (time, seq) min-heap, generic payload.
        ecs/                    Sparse-set, no libs, deterministic iteration.
        dungeon/                Pure-pass pipelines — rim, caverns.
        game/                   Tick reducer, AI, abstract resolvers, zone transitions.
  client/                       Vite + React 19. Renders state, forwards keys.

docs/
  MAP.md                        First stop for orienting in the repo.
  GAME-LOOP.md                  Phase 1-2 mental model: scheduler, tick, drain, RNG threading.
  LIVING-WORLD.md               Phase 3+ multi-zone architecture, audit, phasing.
  PROCGEN.md                    Pass-by-pass walk-through of every dungeon style.
  DESIGN-PILLARS.md             The five design pillars (FR). Every feature must serve two.

registry/                       The world itself — open notebook, not code.
```

---

## Stack

| Layer | Choice |
|---|---|
| Runtime + package manager | **Bun 1.3** (lockfile `bun.lock`) |
| Monorepo | **Turborepo 2** (workspaces `apps/*`, `packages/*`) |
| Server | **Elysia 1.4** + **TypeBox** |
| Client | **Vite 8** + **React 19** |
| WS contract | **Eden Treaty** (`import type { App } from "server"`) |
| Quality | **Biome 2.4** + **`bun:test`** |
| TypeScript | **6.0**, strict, no `as` (except `brands.ts` factories), no `!` |

---

## Getting started

```sh
bun install
bun run dev
```

Vite at <http://localhost:5173>, Elysia at <http://localhost:3000>, both in parallel via Turbo.

**In-game keys:** `WASD` or arrows to move, `.` or `Space` to wait, `>` to enter the other zone.

---

## Useful commands

From the repo root:

```sh
bun run build         # Build all apps and packages
bun run lint          # biome check (lint + format + imports)
bun run lint:fix      # biome check --write (apply safe fixes)
bun run check-types   # Typecheck all workspaces
bun test              # Run the full test suite
```

From `apps/server/`:

```sh
bun run preview --style rim --seed 42      # ASCII preview of a generated level
bun run preview --style caverns --seed 7
bun run bench                              # sfc32 PRNG bench
bun run bench:ecs                          # ECS standard scenarios
bun run bench:ecs:agg                      # 100-run aggregate with min/median/p95
bun run bench:ecs:mega                     # N=100 000 stress
bun run bench:scheduler                    # Min-heap scheduler bench
bun run bench:dungeon:connect              # Cavern flood-fill connectivity
```

---

## Tour the codebase

Per-domain READMEs are the entry-point reference for each module. The companion `docs/` files are the deep dives — read them before reinventing or grepping.

| Module | Entry | Deep dive |
|---|---|---|
| Codebase map | [`docs/MAP.md`](docs/MAP.md) | — |
| RNG | [`apps/server/src/domain/rng/README.md`](apps/server/src/domain/rng/README.md) | — |
| Scheduler | [`apps/server/src/domain/scheduler/README.md`](apps/server/src/domain/scheduler/README.md) | [`docs/GAME-LOOP.md`](docs/GAME-LOOP.md) § "The scheduler" |
| ECS | [`apps/server/src/domain/ecs/README.md`](apps/server/src/domain/ecs/README.md) | [`docs/MAP.md`](docs/MAP.md) § "ECS conventions" |
| Dungeon procgen | [`apps/server/src/domain/dungeon/README.md`](apps/server/src/domain/dungeon/README.md) | [`docs/PROCGEN.md`](docs/PROCGEN.md) |
| Game loop | [`apps/server/src/domain/game/README.md`](apps/server/src/domain/game/README.md) | [`docs/GAME-LOOP.md`](docs/GAME-LOOP.md), [`docs/LIVING-WORLD.md`](docs/LIVING-WORLD.md) |
| Worldbuilding | [`registry/README.md`](registry/README.md) | [`docs/DESIGN-PILLARS.md`](docs/DESIGN-PILLARS.md) |

---

## Project philosophy

`CLAUDE.md` is the operating manual — read it before contributing. `docs/MAP.md` is the codebase tour. Per-domain READMEs document each module's public surface, its accepted trade-offs, and the **rejected alternatives**.

Negative knowledge is load-bearing here. Every module README ends with a *Why this and not the alternatives* table — patterns that were measured, benchmarked, or audited and explicitly killed, with revisit criteria. If you're tempted to introduce something the docs killed, re-read the rationale first.

> A change is not done until `bun run lint`, `bun run check-types`, and `bun test` are all green locally. "It compiles" is not verification.
