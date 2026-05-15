# Korr Aelvein

A turn-based roguelike with a server-authoritative architecture. Set on an island built around an inexplicable abyss whose presence shapes the world without anyone knowing why; descend, die, descend again.

The world lives in `registry/`. The engine lives here.

## What earns its keep

**Server-authoritative, one source of truth.** WebSocket only, one `/game` endpoint, one TypeBox schema per inbound message. The client is a renderer + input forwarder — no game logic, no prediction, no rollback. `if (canMove(...))` in `apps/client/src/` is a code smell; `Math.random()` is a bug.

**Determinism is a load-bearing contract.** A seed and an action sequence produce a byte-identical `GameState` sequence. The custom sfc32 PRNG (128-bit state, pure 32-bit JS arithmetic, identical sequence across V8/Bun and any modern browser) snapshots into a 4 × i32 tuple that lives in `state.rngState`. Reducers hydrate at the top of a tick, thread through, persist back — that's what lets `(state, action) → state` stay value-semantic while the internal state mutates allocation-free. Pinned by FNV-1a hashes of 200-seed runs across the dungeon generators and a 5-canary ECS regression suite. Hash drift = STOP.

**Custom sparse-set ECS, no library.** Bench medians on Apple Silicon + Bun 1.3.12: `spawn` ~85 ns/op, `setComponent` ~9 ns/op, `forQuery` iterating 5 000 entities in 60 µs. One sparse-set column per component, parity-encoded liveness (no separate `live` set, no ghost-handle window), lifecycle buffers + typed event channels instead of `onAdd`/`onRemove` callbacks (no reentrancy hazards). bitecs / miniplex / koota / flecs-style archetypes were audited and rejected with explicit revisit criteria — `apps/server/src/domain/ecs/README.md` documents the picks and the rejected patterns.

**Multi-zone living world.** Caves-of-Qud-style reality bubble: one zone is `active` (fine-grain AI at action granularity), every other zone is `dormant` (its NPCs deposit events on a single global `(time, seq)` min-heap and advance via pure abstract resolvers). Zone transitions are atomic — park converts in-flight actor turns to schedule events; concretize catches up due events before flipping the discriminator. Full simulation everywhere (Dwarf Fortress) and CDDA's freeze-and-thaw were both considered and rejected; the 2026-05 audit with sources lives in `docs/LIVING-WORLD.md`.

**Pure-pass procgen.** Each dungeon style is a `ReadonlyArray<(Level, Rng) → Level>` recipe. Rim (Brogue-style room accretion) generates 300×150 in ~0.03 ms; caverns (cellular automata) in ~2 ms. No async, no mutation-as-API, no library — every randomness call flows through the injected `Rng`. Adding a style is a folder under `styles/` plus one line in the dispatch table.

**TypeScript with deliberate ergonomics.** `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`, `noImplicitReturns`, `noPropertyAccessFromIndexSignature` — all on. **No `as` (any form, including `as const` and import-rename `import { X as Y }`), no `!` non-null assertion.** Both lie to the type system; the project refactors with `for…of` + `entries()`, runtime guards, or explicit annotations instead. Not yet lint-enforceable — respected on every edit, caught at review.

**End-to-end types over WebSocket.** Eden Treaty pulls `type App` from `apps/server/src/index.ts` via Bun's workspace symlink — the client never redeclares WS message types. Schema, runtime validation, and TS type all derive from the same TypeBox literal (`typeof schema.static`); they cannot drift.

**One tool per job, no debates.** Biome 2 handles lint + format + import-sort from a single root `biome.json`. No ESLint, no Prettier. Bun's built-in test runner — no Jest, no Vitest. **1 348 tests, ~280 ms wall-clock.**

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

registry/                       The world itself — open notebook, not code.
```

## Stack

- **Runtime + package manager** — Bun (lockfile `bun.lock`).
- **Monorepo** — Turborepo. Workspaces `apps/*`, `packages/*`.
- **Server** — Elysia 1.4 + TypeBox.
- **Client** — Vite 8 + React 19.
- **WS contract** — Eden Treaty (`import type { App } from "server"`).
- **Quality** — Biome 2 + `bun:test`.

## Getting started

```sh
bun install
bun run dev
```

Vite at <http://localhost:5173>, Elysia at <http://localhost:3000>, both in parallel via Turbo.

In-game keys: `WASD` or arrows to move, `.` or `Space` to wait, `>` to enter the other zone.

## Useful commands

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
bun run bench                              # sfc32 PRNG bench
bun run bench:ecs                          # ECS standard scenarios
bun run bench:ecs:agg                      # 100-run aggregate with min/median/p95
bun run bench:dungeon:connect              # Cavern flood-fill connectivity
```

## Project conventions

`CLAUDE.md` is the operating manual — read it before contributing. `docs/MAP.md` is the codebase tour. Per-domain READMEs document each module's public surface and the rejected alternatives. Negative knowledge is load-bearing here; if you're tempted to introduce something the docs explicitly killed, re-read the rationale first.
