# Korr Aelvein — Codebase map

Read this **before** grepping or reinventing. Claude: this is your first stop when orienting in this repo.

## Folder structure

```
apps/
  client/             Vite 8 + React 19 SPA. Renders state, forwards input. NO game logic.
  server/             Bun + Elysia. Single source of truth for game state.
    src/
      app.ts          Elysia builder (pure). Use `createApp()` for in-memory testing.
      index.ts        Listener: `createApp().listen(PORT)`, re-exports `type App`.
      tests/          app.test.ts (/health + factory).
      domain/         Pure game logic. No imports from transport/.
        rng/          Seeded sfc32 PRNG with serialisable state.
          index.ts                          PRNG public surface.
          tests/                            index.test.ts.
          bench/                            main.bench.ts.
        ecs/          Sparse-set ECS — see `apps/server/src/domain/ecs/README.md`.
          *.ts                              world / query / forQuery / components / entity / system.
          tests/                            world / query / forquery / system / determinism / stress.
          bench/                            standard.bench.ts + mega.bench.ts.
        scheduler/    Min-heap turn scheduler — see `docs/GAME-LOOP.md`.
          index.ts                          emptyScheduler / schedule / peek / pop / size.
          tests/                            index + properties (heap invariants, ties, sort-drain).
        game/         Turn-based game loop — see `docs/GAME-LOOP.md` (Phase 1-2) and `docs/LIVING-WORLD.md` (Phase 3-6+).
          index.ts                          public barrel.
          types.ts                          ZoneId / Time / ZoneStatus / GlobalEvent / GameState / Action / Dir.
          newGame.ts                        newGame + spawnDonjonZone + spawnVillageZone.
          state.ts                          getZone + activeZoneStatus + activeWorld + activeLevel + entityAt.
          tick.ts                           tick reducer + drainNonPlayer (dispatch on GlobalEvent.kind).
          ai.ts                             runAi dispatcher (in-bubble) + per-kind handlers (wanderer).
          abstract.ts                       applyAbstract (off-zone NPC schedules — Phase 4).
          combat.ts                         attack (Phase 5 bump-combat, pure-on-world).
          transition.ts                     parkActiveZone + concretize + enterZone (Phase 6 zone transitions).
          tests/                            tick + wanderer + village + combat + transition.
        dungeon/      Procgen — see `docs/PROCGEN.md` for the full story.
          types.ts, grid.ts, index.ts       Level/Tile types, flat-array helpers, public surface.
          tests/                            grid / index / properties — foundation + adversarial.
          bench/                            connect-components.bench.ts + place-cavern-stairs.bench.ts.
          styles/rim/                       Brogue-style room accretion.
            <passes>.ts, index.ts           5 passes + pipeline recipe.
            tests/                          per-pass + integration / invariants / determinism / edge-cases.
          styles/caverns/                   Cellular-automata caves.
            <passes>.ts, index.ts           5 passes + pipeline recipe.
            tests/                          per-pass + ca-correctness / integration / invariants / determinism / edge-cases.
    scripts/          CLI utilities (not benches — see per-module bench/ folders).
      preview-dungeon.ts                   ASCII preview of any (seed, style).
      preview-shrine.ts                    Demo of constraint-as-pass.
packages/
  typescript-config/  Shared tsconfigs (base, react-library).
.github/workflows/    CI: lint + typecheck + test + build on PR/push.
docs/                 Technical docs — MAP, PROCGEN, GAME-LOOP, LIVING-WORLD.
registry/             Worldbuilding + narrative-design notes (not code). See `registry/README.md`.
biome.json            Single quality config (lint + format + organize-imports).
CLAUDE.md             Project rules — read every session.
turbo.json            Build / dev / test / check-types tasks.
```

## Modules and their public surfaces

### `@korr-aelvein/typescript-config`

- Two presets: `base.json` (runtime-agnostic, no DOM) and `react-library.json` (extends base + DOM lib + JSX).
- All workspaces extend one of these. Don't add lib/types directly to per-app tsconfigs; modify the shared preset instead.
- Strict flags enabled: `noUncheckedIndexedAccess`, `verbatimModuleSyntax`, `exactOptionalPropertyTypes`, `noImplicitOverride`, `noImplicitReturns`, `noPropertyAccessFromIndexSignature`.

### `apps/server`

- **Entry point**: `src/index.ts` calls `createApp().listen(PORT)`. Re-exports `type App` for the client via Eden Treaty.
- **App builder**: `src/app.ts` — pure `createApp()` that returns the Elysia instance without listening. Use this from tests: `await createApp().handle(new Request(...))`.
- **WebSocket**: `/game` with TypeBox `body` and `response` schemas. Inbound validation is the security boundary of the server-authoritative model.
- **HTTP**: `/health` returns `{ ok: true }`.
- **Port**: `3000` (override with `PORT` env var; declared in `turbo.json#globalEnv`).
- **Game logic**: lives under `src/domain/`. Currently `rng/` (PRNG infra), `dungeon/` (procgen), and `game/` (tick loop).
- **Public package exports** (`package.json#exports`): `./src/index.ts` for both `types` and `import` conditions — that's how the client pulls `App` via `import type { App } from "server"`.

### `apps/server/src/domain/dungeon`

- **Public API**: `generateLevel(rng, w, h, style)`, `StyleId = "rim" | "caverns"`, `emptyLevel`, `runPipeline`, types (`Level`, `Tile`, `Grid`, `Room`, `Pass`, `Pipeline`), grid helpers (`idx`, `inBounds`, `getTile`, `DX4`/`DY4`).
- **Architecture**: pipeline of pure passes `(Level, Rng) => Level`. Each style is a `Pipeline = ReadonlyArray<Pass>` recipe. Adding a style = adding a folder under `styles/`.
- **Reproducibility**: same seed → byte-identical `Level`. 200 seed-runs pinned via FNV-1a hash regression (`styles/{rim,caverns}/tests/determinism.test.ts`).
- **Perf**: rim ~0.03 ms, caverns ~2 ms at 300×150 (~95× speedup vs initial O(N²) algorithm).
- **CLI**: `bun run preview --style {rim,caverns} --seed N` from `apps/server/`.
- **Full doc**: `docs/PROCGEN.md` covers passes, constraints, determinism contract, and rejected alternatives.

### `apps/server/src/domain/rng`

- **Public API**: `createRng(seed: number)`, `fromRngState(state: RngState)`, `Rng`, `RngCore`, `RngState`. High-level ops (`int`/`pick`/`chance`/`split`) live as methods on the `Rng` wrapper.
- **Lifecycle in reducers**: `const rng = fromRngState(state.rngState); … return { ...state, rngState: rng.state() };`.
- **Algorithm**: sfc32 (128-bit state) + SplitMix32 expansion. Pure 32-bit JS arithmetic, no BigInt. Identical sequences across V8/Bun and any modern browser.
- **Why this and not Mulberry32 / PCG / xoshiro / wyrand / ChaCha8**: see the docstring at the top of `index.ts` and `~/.claude/projects/-Users-asgarrrr-Documents-Projects-korr-aelvein/memory/project_design_decisions.md`.
- **Bench**: `bun run bench` (in `apps/server`). Reference: `next() ≈ 4.6 ns/op`, `pick(arr[10]) ≈ 36.5 ns/op` (O(n) is the cost of the no-`as`/no-`!` rule, accepted).

### `apps/server/src/domain/scheduler`

- **Public API**: `emptyScheduler()`, `schedule(s, delay, payload)`, `scheduleAt(s, time, payload)`, `peek(s)`, `pop(s)`, `size(s)`, `removeWhere(s, predicate)`, types `Scheduler` / `ScheduledEvent`. `scheduleAt` and `removeWhere` land with Phase 6 zone transitions — absolute-time scheduling so the player's next-turn slot survives catchup-induced `now` advance, and a one-shot batch delete for events tied to a parking / concretising zone.
- **Algorithm**: binary min-heap keyed on `(time, seq)`. Insertion-order `seq` (owned by the scheduler, not derived from `World` column layout) breaks `time` ties deterministically.
- **Mutation model**: mirrors `World`. `Scheduler` is mutated in place; the surrounding `GameState` wrapper rotates per tick.
- **Stale handles**: lazy skip on pop. `pop` always advances `now` to the popped event's `time`, even when the event is stale. Eager removal would be O(n) in a binary heap and isn't worth it at our entity scale.
- **Multi-action turns**: re-schedule the same handle twice with smaller delays; both pop before slower actors get a slot. No special case in the heap.
- **Why this and not Hauberk-style energy / indexed PQ with decrease-key / hashed timing wheel**: see `docs/GAME-LOOP.md` § "The scheduler".

### `apps/server/src/domain/game`

- **Public API**: `newGame(seed, style)`, `tick(state, action)`, `attack(world, rng, target)`, `entityAt(world, x, y)`, `runAi(state, rng, handle)`, `applyAbstract(zone, entity)`, `parkActiveZone(state, id)`, `concretize(state, id)`, `enterZone(state, target, actionCost)`, `getZone / activeZoneStatus / activeWorld / activeLevel`, types `GameState` / `Action` / `Dir` / `ZoneId` / `ZoneStatus` / `GlobalEvent` / `Time` / `AttackResult`. `Ai` and `Schedule` are component types — import from `domain/ecs/index` (only `Ai` is re-exported there today; `Schedule` lives on the component but isn't surfaced until a caller needs it).
- **Multi-zone shape**: `GameState.zones: Map<ZoneId, ZoneStatus>` with one `active` zone and zero or more `dormant` zones. `globalScheduler: Scheduler<GlobalEvent>` carries actor turns *and* schedule events on a single timeline.
- **Loop shape**: pure-ish reducer `(state, action) → state`. RNG is hydrated once per tick from `state.rngState`, threaded through the action and the drain loop, persisted back to the returned wrapper.
- **Drain dispatch**: `drainNonPlayer` switches on `GlobalEvent.kind` — `actor` runs `runAi` (in-bubble AI), `schedule` runs `applyAbstract` (off-zone NPC). A `never` exhaustiveness sentinel forces new variants to land alongside their dispatcher.
- **AI dispatch (in-bubble)**: discriminated-union `Ai` + `switch(ai.kind)` with the same `never` sentinel.
- **Refused-action contract**: if `MOVE` fails validation (bounds / wall / occupancy), `tick` returns `state` by reference. No `pop`, no reschedule, no turn cost.
- **Full story** (data shapes, determinism contract, accepted trade-offs, rejected alternatives, the multi-zone roadmap): `docs/GAME-LOOP.md` (Phase 1-2 deep-dive) and `docs/LIVING-WORLD.md` (Phase 3-4+).

### `apps/client`

- **Entry point**: `src/main.tsx` mounts `<Game />`.
- **Eden client**: `treaty<App>(SERVER_URL)` instantiated once at module scope in `src/Game.tsx`. The client never re-declares WS message types.
- **WS connection**: opened in `useEffect`, cleanup closes the socket. React 19 StrictMode causes a dev-only double-mount; not a bug.
- **Build**: `tsc -b && vite build`. Output to `dist/` (gitignored).
- **Dev port**: `5173`.

## Established patterns (use these, don't reinvent)

| Need                                         | What we use                                     | Where                                            |
| -------------------------------------------- | ----------------------------------------------- | ------------------------------------------------ |
| Seeded determinism                           | sfc32 with state in `GameState.rngState`        | `apps/server/src/domain/rng/`                    |
| WS contract                                  | TypeBox `body` + `response` per handler         | `apps/server/src/index.ts`                       |
| Client → server type sharing                 | Eden Treaty + workspace dep `server`            | `apps/client/src/Game.tsx`                       |
| Indexed array access without `as` / `!`      | `for (const [i, item] of arr.entries())`        | `apps/server/src/domain/rng/index.ts:nthOrThrow` |
| Verification before "done"                   | Stop hook                                       | `.claude/hooks/before-stop.sh`                   |
| Adversarial code review                      | Subagent `code-critic`                          | `.claude/agents/code-critic.md`                  |
| SOTA / library / algorithm pick research     | Skill `/research-before-recommending`           | `.claude/skills/research-before-recommending/`   |
| Workspace dep declaration (Bun-idiomatic)    | `"<name>": "workspace:*"`                       | every `package.json` in workspaces               |
| Type-only import from another workspace      | `import type { X } from "<workspace>"` via Bun symlink | `apps/client/src/Game.tsx`                |

## Don't reach for these — explicit rejections

Considered, deliberately not used. Re-read the rationale before challenging.

- **ESLint, Prettier** — replaced by Biome (single tool for lint + format + organise-imports). See `feedback_official_scaffolds.md`.
- **`as` casts, `!` non-null, `as const`, import-alias `import { X as Y }`** — banned project-wide. Refactor with `for…of` / `entries()`, runtime guards, or local renames. See `feedback_no_as_no_nonnull.md`.
- **Mulberry32** — superseded by sfc32 (period exhaustion at 2³², ~1/3 missing u32 outputs).
- **PCG / wyrand** — need 64-bit arithmetic → BigInt → 10–60× slowdown in V8. Not viable for browser-side determinism.
- **xoshiro128++** — known low-bit weakness, fails linear-complexity tests (Vigna's own docs).
- **ChaCha8** — overkill (cryptographic) and ~10× slower than sfc32 in pure JS.
- **External ECS libs (bitecs, miniplex, koota), Redux, Zustand, effect-ts, Result/Either libs** — premature for our scale and turn-based loop. We ship our own minimal sparse-set ECS at `apps/server/src/domain/ecs/`; see its README + conventions below.
- **Next.js, SSR, RSC** — client is and stays a Vite SPA targeting a Canvas/WebGL game.
- **Database, ORM, persistence layer** — server state lives in memory only, until explicitly asked otherwise.
- **`packages/game-core`** — not extracted preemptively. Trigger: same type duplicated between client and server. Until then, types live in `apps/server/src/domain/`.

For the full rationale of any item: `~/.claude/projects/-Users-asgarrrr-Documents-Projects-korr-aelvein/memory/project_design_decisions.md`.

## ECS conventions (`apps/server/src/domain/ecs/`)

The home-grown ECS is sparse-set, AoS storage, parity-encoded liveness, with `with`/`without` filters, lifecycle buffers, and typed event channels. Three feature families were deliberately rejected — each has revisit criteria so we don't relitigate.

### Relations (entity → entity) — convention, no native primitive

Use a regular component whose value carries the target's `EntityId`:

```ts
type ChildOf = { readonly parent: EntityId };
type OwnedBy = { readonly target: EntityId };
```

Inverse lookups (`who owns id X`?) iterate the relation column and filter — `O(N_relation)`, acceptable at N≤5000.

Why not flecs-style native pairs:
- Sparse-set AoS does not store archetype bitmasks; native pairs assume archetype indexing.
- ~5–10 % overhead per add/remove (hashmap pair lookup) — unjustified at our scale.

Revisit when **both** are true: a feature needs > 2 inverse lookups per tick at N≥1000, AND bench shows the convention costs > 5 % of the tick budget.

### Archetypes / fragmented_iter — rejected

Storage is one sparse-set column per component. Multi-key queries pivot on the smallest column and probe secondaries via `sparse.get`. Hot paths today are 1–2 keys (`[position]`, `[position, hp]`).

Why not EnTT-style groups:
- Owning groups reshuffle columns → breaks the "insertion order stable" invariant; complicates snapshot.
- Non-owning groups (parallel `Set<EntityId>` of matching entities) add maintenance per add/remove for unclear win at our scale.

Revisit when **both** are true: a 4+ key query appears in a real system (not hypothetical), AND bench shows it consumes > 5 % of the tick budget at N≥5000. Prefer non-owning groups (lightweight, no reshuffling).

### Hooks (`onAdd` / `onRemove` callbacks) — rejected

Sync component-lifecycle callbacks would break the pure-reducer model `(state, action) → state` and introduce reentrancy hazards (a callback that triggers `setComponent` re-enters the same code path). `drainEntered` / `drainExited` (lifecycle buffers) plus `defineEvent` / `emit` / `drain` cover every legitimate use case without these inconveniences. No revisit criteria — this one stays rejected.

## External references — canonical sources, 2026-05

When in doubt about how a tool works, fetch the canonical docs (don't rely on training-distribution recall).

- **Biome 2.4** — https://biomejs.dev (config schema in `biome.json` `$schema`).
- **Elysia 1.4** — https://elysiajs.com.
- **Eden Treaty (WS)** — https://elysiajs.com/eden/treaty/websocket.html.
- **Bun workspaces** — https://bun.com/docs/pm/workspaces.
- **Bun test runner** — https://bun.com/docs/cli/test.
- **TypeBox** — https://github.com/sinclairzx81/typebox.
- **Vite 8** — https://vite.dev.
- **Turborepo** — https://turborepo.dev.
- **Claude Code skills** — https://code.claude.com/docs/en/skills.
- **Claude Code subagents** — https://code.claude.com/docs/en/sub-agents.
- **Claude Code hooks** — https://code.claude.com/docs/en/hooks.
- **Claude Code memory & CLAUDE.md** — https://code.claude.com/docs/en/memory.

## Setting (story / lore)

An island built around a vast inexplicable abyss whose presence shapes the world for unknown reasons. A town encircles the rim; people live, work, descend.

_Korr_ and _Aelvein_ are invented proper nouns — their referents (town, abyss, order, era, dynasty) crystallise as the lore is written. **Do not translate to English equivalents in code or copy.**

## Maintenance

This file is checked into git and shared with the team. Keep it under ~150 lines. When a section of CLAUDE.md grows to describe "where things live", move it here. When this file grows past 150 lines, split (e.g., `docs/PATTERNS.md`).
