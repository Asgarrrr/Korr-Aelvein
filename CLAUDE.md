# Korr Aelvein

Turn-based, single-player roguelike with a **server-authoritative** architecture. The server is the single source of truth for game state; the client renders state and forwards input.

> **Orienting in this repo? Start with `docs/MAP.md`** — folder layout, public APIs of every module, established patterns (use these, don't reinvent), and the explicit list of approaches we considered and rejected. Read it _before_ grepping or proposing a new abstraction.

**Setting** (informs naming and tone, no gameplay impact yet): an island built around a vast inexplicable abyss whose existence affects the whole world for unknown reasons. A town encircles the rim; people live, work, and descend. _Korr_ and _Aelvein_ are invented proper nouns — assign them to in-world referents (the town, the abyss, an order, an era) as the lore solidifies; do not translate them to English equivalents in code or copy.

## Stack

- **Runtime / package manager**: Bun (lockfile is `bun.lock`).
- **Monorepo**: Turborepo. Workspaces: `apps/*`, `packages/*`.
- **Server** (`apps/server`): Bun + **Elysia**. Endpoints: WS `/game`, HTTP `/health`. Default port `3000` (override with `PORT`).
- **Client** (`apps/client`): **Vite + React 19** SPA. Dev port `5173`. Targeting a 2D tilemap (Canvas / WebGL).
- **Shared**: `packages/typescript-config` only (`base.json`, `react-library.json`).
- **Quality tooling**: **Biome 2** (`biome.json` at the root) — single tool for lint + format + organize-imports. No ESLint, no Prettier.
- **WS validation**: TypeBox via Elysia (`body` / `response` schemas on every handler).
- **End-to-end types**: Eden Treaty (`@elysia/eden`). The `server` workspace exposes `type App = typeof app` via `exports` in its `package.json`; the client imports it as `import type { App } from "server"` (Bun workspace symlink, no path alias). Client uses `treaty<App>(url)` and never declares its own copy of WS message types.

## Commands (run from repo root unless noted)

- `bun install` — install dependencies.
- `bun run dev` — Vite + Elysia in parallel via Turbo.
- `bun run lint` — `biome check .`.
- `bun run lint:fix` — `biome check --write .`.
- `bun run format` — `biome format --write .`.
- `bun run check-types` — typecheck every workspace.
- `bun test` — Bun's built-in test runner across workspaces.
- `bun run build` — Vite build for `apps/client`.
- Workspace-scoped: `cd apps/server && bun run dev`.

## Architecture invariants (do NOT violate)

- **Server is the only source of truth.** RNG, movement validation, combat, loot rolls, line-of-sight, level generation: server only.
- **Never put game logic on the client.** If you find yourself writing `if (canMove(...))` or `Math.random()` in `apps/client/src/`, stop — send the action over WS, let the server respond with the new state. The client is a renderer + input forwarder, nothing else.
- **Turn-based loop**: one player action → one server tick → one state push (full or diff) over WS. No client-side prediction, no rollback, no speculative execution.
- **Single transport: WebSocket**, single endpoint `/game`. No REST routes for gameplay.
- **Validate every inbound WS message with TypeBox** (`body` schema on Elysia handlers). Also declare a `response` schema. Trusting client-shaped data is the failure mode of a server-authoritative architecture.
- **All randomness flows through `GameState.rngState`**, never `Math.random()`. Reducers rehydrate via `fromRngState(state.rngState)` at the start of a tick and persist the new state via `rng.state()` in the returned `GameState`. This is what makes save/load/replay deterministic _and_ keeps reducers pure `(state, action) → state`.
- **Never duplicate WS message types on the client.** The client _consumes_ `type App` from `apps/server/src/index.ts` via Eden Treaty — it does not redeclare shapes.

## Code style and types

Biome handles formatting and import order — don't argue with it, let it run.

- TS strict everywhere (extends `@korr-aelvein/typescript-config/base.json`). `noUncheckedIndexedAccess` is on — treat `arr[i]` as possibly `undefined`.
- **Never use `as` (any form, including `as const` and import-rename `import { X as Y }`) or non-null assertion (`!`) in TS.** Both lie to the type system. Refactor instead: `for (const [i, item] of arr.entries())` for safe indexed access, runtime guards for nullables, explicit type annotations (`const x: "lit" = "lit"`) instead of `as const`, and rename local symbols to avoid import-aliasing clashes. Not currently lint-enforceable — respect on every edit.
  - **One sanctioned exception:** a branded-type factory in a file named `brands.ts` may use a single `as` to construct the brand (`return n as ZoneId`). Branding a runtime `number` is a widening TS cannot express without an assertion; the assertion is provably safe (it only tags a value) and confined to one greppable place. Outside `brands.ts` the codebase carries zero `as` assertions and zero `import { X as Y }` renames — to avoid a rename, use a namespace import (`import * as ns`) or a local `const alias = orig`; both bind faithfully and are allowed, only the type-lying `as` / `as const` and the avoidable `{ X as Y }` rename are banned. Biome has no rule to enforce this, so it stays review-enforced like the base rule.
- New shared types or constants live in the workspace that owns them until duplication appears (see `packages/game-core` rule below).

## Testing

- Use **`bun:test`** (Bun's built-in runner). Do not introduce Jest or Vitest.
- **Test the server's pure game logic from day one**: seeded RNG, tick reducers, level generation, combat resolution. These are pure `(state, action) → state` and trivially testable.
- A change is not done until `bun run lint`, `bun run check-types`, and `bun test` are all green locally. "It compiles" is not verification.

## Don'ts (project-specific)

- **Don't put game logic on the client.** (Repeated because it's the single most important rule.)
- Don't reintroduce ESLint or Prettier. If a rule is missing, configure it in `biome.json`.
- Don't propose Next.js, SSR, or React Server Components. The client stays a Vite SPA.
- Don't add a database, ORM, or persistence layer without an explicit user ask. State lives in server memory.
- Don't extract `packages/game-core` preemptively. The trigger is "the same type is duplicated between `apps/client` and `apps/server`" — when that hits, propose the extraction; don't do it before.
- Don't add a state-management library on the client (Redux, Zustand, etc.) before a concrete need shows up. React state + context is enough for a renderer.

## Before declaring done (mandatory ritual)

After any non-trivial change (new feature, refactor > 30 lines, algorithm pick, architecture decision), before saying "done" / "tout vert" / "all green":

1. **Run, don't claim.** Actually execute `bun run lint`, `bun run check-types`, and `bun test`. Don't infer green-ness from "the diff looks clean".
2. **State 2-3 trade-offs you accepted** (perf, readability, lying-to-types, validation contradicting global rules, etc.). If genuinely none, say so explicitly.
3. **Cite one alternative you rejected.** "I considered X but went with Y because Z." If you can't, you didn't think hard enough.
4. **Self-critique.** Spend a real 60 seconds asking _"what would a senior reviewer push back on here ?"_ and surface at least one item.
5. **For changes > 100 lines or touching architecture / algorithms** : invoke the `code-critic` subagent on the diff and adopt or rebut each of its findings before declaring done.
6. **For algorithm / library / architecture picks** : invoke the `/research-before-recommending` skill _first_, list 3-5 alternatives with trade-offs, _then_ commit. No assumed defaults from the training distribution.

Never say "tout vert" without enumerating the accepted compromises. "Looks clean" is not a verification.

## Where things live

- Game logic, RNG, tick reducers: `apps/server/src/`.
- WS handlers + TypeBox schemas: `apps/server/src/index.ts` (split into modules as it grows).
- Rendering, input forwarding, UI: `apps/client/src/`.
- Shared TS configs: `packages/typescript-config/`.
- Single quality config: `biome.json` at repo root.
