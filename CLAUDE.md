# Korr Aelvein

Turn-based tactical roguelike in the browser, with an authoritative server.
The dungeon lives without the player: on every floor, creatures eat, hunt,
flee and migrate whether the player is there or not.

Anything outside the current scope goes to `docs/ideas.md`, never into code.
This file holds rules, not progress: progress lives in git and in the plan.

## How we build

- One core rule: every creature has needs and acts to satisfy them. A new
  mechanic extends needs or the environment that shapes them. Never a
  parallel system with its own decision logic.
- One mechanic = one module folder. Adding a mechanic adds a folder;
  removing it leaves a running game.
- Extract seams from real cases, not guesses: the module interface is
  extracted at the second mechanic, the core API is frozen at the third.
  No abstraction without two real implementations (a test fake counts).
- Values are data, rules are code. A number, name, list or color that tunes
  the game lives in a config file; anything with an "if" is code. Never
  encode rules in data (no conditions in config).
- Simulation first, visuals second. A mechanic is proven in the ASCII debug
  view before it gets 3D rendering.
- Before creating a file, helper, or type, have an `Explore` subagent on
  `haiku` search for an existing one.

## Where code goes

Everything has one address. Decide where code goes before writing it. If no
row fits, that is a design question: propose a new row before coding.

| What | Where |
|---|---|
| Entity storage: ids, columns, queries (imports nothing else from core) | `packages/engine/src/core/ecs/` |
| Foundation rule: grid, turns, actions, arbitration, health, death, events, RNG | `packages/engine/src/core/<domain>/` |
| Tuning values of the core: score scale, ticks per turn, capacities | `packages/engine/src/core/config.ts` |
| The engine surface a module sees: `api.ts`, the only core file a module may import, and the ctx | `packages/engine/src/core/module/` |
| The `World` API the game wraps | `packages/engine/src/core/world/` |
| One mechanic: its needs, components, systems | `packages/engine/src/modules/<mechanic>/` |
| Tuning values of a mechanic: rates, thresholds | `packages/engine/src/modules/<mechanic>/config.ts` |
| A behaviour of a mechanic: its action, in its own file | `packages/engine/src/modules/<mechanic>/behaviours/<behaviour>.ts` |
| Species: which components, with which values | `packages/engine/src/content/species/` |
| Type read by two or more modules | `packages/engine/src/contracts/` |
| Which modules run, in which order | `packages/engine/src/registry.ts` |
| The Game and its factories | `packages/engine/src/game.ts` |
| The engine's public entry: what the server may import | `packages/engine/src/index.ts` |
| Floor and world generation | `packages/engine/src/world/` |
| Message between web and server | `packages/protocol/src/` |
| Connections, sessions, persistence, hosting the engine | `apps/server/src/` |
| 3D rendering | `apps/web/src/render/` |
| ASCII debug view | `apps/web/src/debug/` |
| Keys and clicks → player commands | `apps/web/src/input/` |
| Rendering settings: sizes, durations, palette | `apps/web/src/theme.ts` |
| Tests | `<package>/test/`, mirroring `src/` |
| Engine benchmarks (`bun run bench`, not part of `verify`) | `packages/engine/bench/` |
| Design plans | `docs/plans/` |
| Domain glossary: one name per concept | `CONTEXT.md` |
| Repository tooling | `scripts/` |
| Rust simulation crates, during the rewrite (layout: `docs/plans/rust-structure.md`) | `apps/server-rs/crates/sim/<crate>/` |
| Rust entity storage: ids, handles, columns, floor images, travellers (imports no workspace crate) | `apps/server-rs/crates/sim/ecs/` |
| Rust ECS benchmarks against hecs and bevy_ecs (cargo bench, not part of verify) | `apps/server-rs/crates/host/tools/ecs-bench/` |
| Rust server, during the rewrite | `apps/server-rs/crates/host/server/` |
| Rust tooling: toolchain pin, workspace lints | `apps/server-rs/` root files |

- One file = one subject. Past ~400 lines, or when a second subject
  appears, split into a folder by subject: `combat/{damage,status}.ts`,
  never `combat2.ts`.
- When adding code, name the table row that justifies its location. If the
  change pushes a file past the limit, propose the split in the same change.
- Enforcement, all part of `verify`. Never weaken a rule to get green: fix
  the code, or propose a rule change.
  - Biome (`biome.json`): undeclared dependencies everywhere; in the engine,
    Node modules, magic numbers and nondeterministic calls
    (`scripts/lint/determinism.grit`).
  - `scripts/check-architecture.ts`: the module graph, relative imports
    leaving their package, the file size limit.
  - Hooks: `.claude/settings.json` runs the architecture check after every
    `.ts` edit by Claude; `scripts/githooks/pre-commit` runs `verify` before
    every commit (enabled by `bun install`). Never bypass with `--no-verify`.

## Comments

Claude over-comments by default, and new code copies the comment density of
the code around it: every needless comment breeds more.

- Default to no comment. Code shows *how*; a comment carries only a *why*
  the code cannot show: a non-obvious constraint, a deliberate deviation, a
  gotcha, a workaround and its reason.
- Never narrate the code, restate names, types or signatures, or mark the
  end of a block.
- Never write history: "fixed", "now uses", "previously", "added for",
  "as requested". A comment must read correctly to someone who never saw
  the diff. Change context goes in the commit message.
- Never write plans or justifications: no "for later", "in case we need",
  "TODO". Ideas go to `docs/ideas.md`.
- One or two short lines. No comment blocks, no docstrings that repeat the
  signature.
- Before committing a multi-file change, run the `comment-cleanup` skill on
  the diff.

## Commands

- verify: `bun run verify` — lint, architecture check, typecheck, tests,
  build. The definition of done.
- test: `bun run test` — single file: `bun test <path>` from the package dir
- dev: `bun run dev` — server on :3000, web on Vite's port, `/ws` proxied
- lint fix: `bun run lint:fix`
- Rust: `verify` also runs `cargo test`, `clippy -D warnings` and
  `fmt --check`, as scripts of `apps/server-rs/package.json`. Rules:
  `.claude/rules/rust.md`.
- Rust ECS bench: `cargo bench -p korr-ecs-bench --bench ecs` in
  `apps/server-rs/`. Not part of `verify`.
- New worktree or clone: run `bun install` first. Without it every check
  fails (exit 127) and the git hooks are not enabled.
- Turborepo changes between versions: read `node_modules/turbo/docs/` before
  editing `turbo.json`.

## Architecture

- `packages/engine` — the simulation. Pure TypeScript: no DOM, no Three.js,
  no network, no `Math.random`, no wall clock.
- `packages/protocol` — message schemas between web and server and the
  types derived from them. No logic.
- `apps/server` — Elysia. Hosts the engine and owns all game state. The only
  place where game outcomes are computed.
- `apps/web` — Vite + Three.js. Sends player commands, renders server
  snapshots. Never computes an outcome.
- Dependency direction: `web → protocol`; `server → engine, protocol`.
  `engine` imports no workspace package.
- The Vite proxy targets `127.0.0.1`, not `localhost`: `localhost` resolves
  to `::1` first and the server listens on IPv4 only.

## Engine invariants

- Core owns: grid, position, turn scheduler, action execution, needs
  arbitration, health, death, containment, the event queue. These cannot be
  disabled. Full design: `docs/plans/ecs-core.md`.
- Mechanic modules (hunger, fear, fire...) propose scored candidate actions.
  They never set a creature's action; the core picks one per creature. Ties
  break on stable action keys, never on registry order.
- A player is an actor whose decision comes from a recorded input. The
  engine never waits: it stops when a player is due and the server supplies
  inputs.
- Creatures act one at a time on the current state. Bulk systems are only
  for environment ticks (fire spread, need decay). A bulk tick writes only
  the row it iterates, an owned cell column read from its previous-turn
  buffer, or an owned cell column it clears and fills by an
  order-independent combine (OR, max); its kills and spawns are deferred.
- Events broadcast facts; they never drive behaviour. One FIFO queue per
  turn, each event records its cause, a per-turn cap throws.
- Ordered rules (death → drop → remove) are direct core calls, not events.
- A module never imports another module. Shared types live in `contracts/`,
  and only once a second module reads them. Contracts hold no logic.
- An action declares the components its actor must have; the core checks
  them before every run.
- A module writes only its own components. Health changes only through
  `harm`, applied by the core. A module reads another module's component
  only through a getter view typed by `contracts/`, and keeps no state
  outside registered columns. Scratch fully overwritten at the start of
  every callback, and never read before that overwrite, is not state.
- Module order comes from one explicit list in `registry.ts`, never from
  file order. Only `registry.ts` and `content/` may import a module.
- Every random draw derives from hash(seed, module name, phase, time,
  subject, draw index). Adding a module must not shift other modules' draws.
- Config values used by the engine are integers (3 per turn, not 0.03).
- Integer math in the engine. No `Math.pow`, `Math.exp` or other
  transcendental functions: their precision differs between engines.
- Entity ids are `originFloor * 2^25 + counter`: monotonic per origin floor,
  never reused. Storage slots are recycled and never leave a core callback.
- In korr-ecs an `EntityId` is `origin floor << 47 | counter`, 63 bits, never
  reused. A `Handle` (slot, generation) is floor-local and never sent to
  another floor or over the network; a slot retires at generation `u32::MAX`.
  A floor image keeps slots, free stack and dense order, so a reloaded floor
  replays identically.
- Every floor runs every system every turn. Creatures re-decide every P
  turns, P set by distance to the nearest player; otherwise they repeat
  their cached action. No separate aggregate model unless measurement
  proves it necessary.
- Hot bulk ticks are monomorphic inline loops over columns, never a shared
  per-row callback.

## Testing

- The engine is tested headless, from a seed: set up a world, run N turns,
  assert an observable outcome (a migration, a death, a population change).
- Every engine bug gets a test with the seed that reproduces it.
- Each mechanic module has a test proving the game runs with it disabled.
- Write the test before the code, and watch it fail first. Never write a
  test after the code to restate it.
- Keep a test only if you can name the plausible bug it catches, and that
  bug makes it fail. Never restate a constant or the implementation's logic.
- Default to the engine scenario above. A narrower test is for a contract a
  scenario cannot pin down: save/load, determinism, a guard, an edge case.
- A test that breaks on a refactor with no behaviour change is a defect:
  rewrite it to assert behaviour, never patch it to match.
- A pinned hash detects a change but never justifies deleting a test: it is
  re-pinned on every intended change, so it guards no single bug.
