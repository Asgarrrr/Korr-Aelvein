# Korr Aelvein

Turn-based tactical roguelike in the browser, with an authoritative server.
The dungeon lives without the player: on every floor, creatures eat, hunt,
flee and migrate whether the player is there or not.

Anything outside the current scope goes to `docs/idees.md`, never into code.
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
| Foundation rule: grid, turns, actions, arbitration, death, events, RNG | `packages/engine/src/core/` |
| One mechanic: its needs, components, systems | `packages/engine/src/modules/<mechanic>/` |
| Tuning values of a mechanic: rates, thresholds | `packages/engine/src/modules/<mechanic>/config.ts` |
| Species: which components, with which values | `packages/engine/src/content/species/` |
| Type read by two or more modules | `packages/engine/src/contracts/` |
| Which modules run, in which order | `packages/engine/src/registry.ts` |
| Floor and world generation | `packages/engine/src/world/` |
| Message between web and server | `packages/protocol/src/` |
| Connections, sessions, persistence, hosting the engine | `apps/server/src/` |
| 3D rendering | `apps/web/src/render/` |
| ASCII debug view | `apps/web/src/debug/` |
| Keys and clicks → player intents | `apps/web/src/input/` |
| Rendering settings: sizes, durations, palette | `apps/web/src/theme.ts` |
| Tests | `<package>/test/`, mirroring `src/` |
| Repository tooling | `scripts/` |

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
  "TODO". Ideas go to `docs/idees.md`.
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
- New worktree or clone: run `bun install` first. Without it every check
  fails (exit 127) and the git hooks are not enabled.
- Turborepo changes between versions: read `node_modules/turbo/docs/` before
  editing `turbo.json`.

## Architecture

- `packages/engine` — the simulation. Pure TypeScript: no DOM, no Three.js,
  no network, no `Math.random`, no wall clock.
- `packages/protocol` — message types between web and server. Types only.
- `apps/server` — Elysia. Hosts the engine and owns all game state. The only
  place where game outcomes are computed.
- `apps/web` — Vite + Three.js. Sends player intents, renders server
  snapshots. Never computes an outcome.
- Dependency direction: `web → protocol`; `server → engine, protocol`.
  `engine` imports no workspace package.
- The Vite proxy targets `127.0.0.1`, not `localhost`: `localhost` resolves
  to `::1` first and the server listens on IPv4 only.

## Engine invariants

- Core owns: grid, turn scheduler (energy), action execution, needs
  arbitration, death, the event queue. These cannot be disabled.
- Mechanic modules (hunger, fear, fire...) propose scored candidate actions.
  They never set a creature's action; the core picks one per creature.
- Creatures act one at a time on the current state. Bulk systems are only
  for environment ticks (fire spread, need decay).
- Events broadcast facts; they never drive behaviour. One FIFO queue per
  turn, each event records its cause, a per-turn cap throws.
- Ordered rules (death → drop → remove) are direct core calls, not events.
- A module never imports another module. Shared types live in `contracts/`,
  and only once a second module reads them. Contracts hold no logic.
- A module writes only its own components.
- Module order comes from one explicit list in `registry.ts`, never from
  file order. Only `registry.ts` and `content/` may import a module.
- Every random draw derives from hash(seed, module, turn, entity). Adding a
  module must not shift other modules' draws.
- Config values used by the engine are integers (3 per turn, not 0.03).
- Integer math in the engine. No `Math.pow`, `Math.exp` or other
  transcendental functions: their precision differs between engines.
- Entity ids are monotonic and never reused.
- Other floors run the same systems at a lower frequency. No separate
  aggregate model unless measurement proves it necessary.

## Testing

- The engine is tested headless, from a seed: set up a world, run N turns,
  assert an observable outcome (a migration, a death, a population change).
- Every engine bug gets a test with the seed that reproduces it.
- Each mechanic module has a test proving the game runs with it disabled.
