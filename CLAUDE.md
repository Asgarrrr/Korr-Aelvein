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
- Simulation first, visuals second. A mechanic is proven in the ASCII debug
  view before it gets 3D rendering.
- Before creating a file, helper, or type, have an `Explore` subagent on
  `haiku` search for an existing one.

## Commands

- verify: `bun run verify` — lint, typecheck, tests, build. The definition of done.
- test: `bun run test` — single file: `bun test <path>` from the package dir
- dev: `bun run dev` — server on :3000, web on Vite's port, `/ws` proxied
- lint fix: `bun run lint:fix`
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
- Module order comes from one explicit list in core, never from file order.
- Every random draw derives from hash(seed, module, turn, entity). Adding a
  module must not shift other modules' draws.
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
