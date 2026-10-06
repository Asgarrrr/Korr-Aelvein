# Plan: host the engine in the server (v3, closed)

Inputs: map of the engine's public API (`packages/engine/src/index.ts`,
`game.ts`, `core/world.ts`), Elysia 1.4.30 source, a WebSocket validation
probe, moltar benchmarks (2026-10-02), a blue-team review of v1, a red-team review of v2.

User decisions:
- JSON on the wire, both directions. Binary only if a measured frame size on
  a real floor justifies it (recorded in `docs/ideas.md`).
- `packages/protocol` holds TypeBox schemas, and the message types derive
  from them. One source of truth for the contract.
- The server validates every client message with Elysia's `t` on `.ws()`.
  No Eden: the web depends on `protocol` only.

## 1. Success criteria

A person runs `bun run dev`, opens the web page, and plays one rat on one
floor in the ASCII debug view: moves with the keys, waits, eats, sees the
other creatures act between its turns, and sees the game end when the rat
dies. Every slice ends with `bun run verify` green and a seeded test.

## 2. Decisions

### D1. Protocol: schemas first

- `packages/protocol/src/` exports TypeBox schemas (`ClientMessage`,
  `ServerMessage`) and `type X = Static<typeof X>` for each.
- `@sinclair/typebox` becomes a dependency of `protocol`, pinned to the
  version Elysia resolves (0.34.52). It is a peer dependency of Elysia, so
  the workspace holds one copy.
- The web imports types only (`import type`). TypeBox stays out of the web
  bundle; a test fails on any value import from `@korr/protocol` under
  `apps/web/src/`.
- Every object schema sets `additionalProperties: false`.
- CLAUDE.md: "`packages/protocol` — message schemas and the types derived
  from them. No logic." replaces "Types only".

### D2. Commands, not engine actions

The client never sends an engine action key. It sends a **command**; the
server maps it to an engine action. "Intent" already names the engine's
cached decision, so the client message is a command (new CONTEXT.md term).

- `{ type: "move", dx, dy }`, `dx`/`dy` integers in [-1, 1], not both 0
  (checked by the server) → `core/step` on cell `(y+dy)*width + (x+dx)`.
  No edge guard in the server: a cell outside the floor plays as
  `core/idle` (`game-world.ts:79-85`), and a row wrap fails the step's
  distance check (`turn.ts:213-220`). Either way the turn passes and the
  player stays put; a test pins it.
- `{ type: "wait" }` → `core/idle`.
- `{ type: "eat", target }`, `target` an EntityId from the last snapshot →
  `hunger/eat`. At distance > 1 the rat walks one step toward the target
  (`hunger/index.ts:36-47`); a non-edible or dead target loses the turn.

An invalid move or target is not rejected: the engine already plays it as
`core/idle` and logs it. The command is still the player's turn.

### D3. Rejection

A message that fails the schema gets `{ type: "rejected", reason }` through
the `.ws()` `error` hook (Elysia otherwise sends its own error body, outside
the protocol). The socket stays open; the game does not advance. `reason`
is a fixed enum (`invalid`, `over`), never Elysia's validator text.

The `.ws()` `error` hook receives the request context, not the socket, so
it cannot close the socket (Elysia `adapter/bun/index.js:278-281`). It
answers `rejected` for a `ValidationError` and logs any other error.

`open` and `message` catch their own errors. A caught error is a server
bug: the handler logs it, drops the session, and closes the socket with
1011.

A throw inside the engine poisons the world for good
(`game-world.ts:117-124`). The session is never retried: it follows the
same path as any server bug.

### D4. Session

- One connection = one session = one game with one player, in memory. No
  persistence, no reconnection, no several players (D13 of `ecs-core.md`
  and `docs/ideas.md`).
- `open`: build the game with `createStarterGame(seed)`, spawn the player
  at `starter.start`, advance until the player is due, send the first
  snapshot.
- `message`: map the command, `world.input`, advance until the player is
  due again or dead, send the snapshot (or `over`).
- Events are off (`createGame({ events: false })`): nothing reads them yet,
  and the hash is identical with events on and off.
- The session is a plain class (`apps/server/src/session.ts`):
  `handle(command): ServerMessage`, deterministic from its seed. `app.ts`
  only wires it to the socket. Rules are tested on the class; the socket
  tests cover transport only.
- `close`: drop the session.
- The advance loop stops when `advance()` returns the player, or when
  `world.locate(player)` is `"dead"`. Without that check a dead player
  loops forever. A round limit per command throws as a backstop.
- `createApp({ seed?, createSession? })`: tests pass a seed, and
  `createSession` lets them inject a failing session; production draws one u32
  with `crypto.getRandomValues(new Uint32Array(1))[0]` (the server may be
  nondeterministic, the engine may not; `createGame` rejects anything but
  a u32).
- A command arriving after `over` gets `rejected`.

### D5. Snapshot

What the player's client receives after each of its turns. "View" already
names the engine's getter views; "Image" names saved floor bytes. A
**snapshot** is the server's message to the client (new CONTEXT.md term).

```ts
{ type: "snapshot", width, height,
  player: { id, x, y, hp, satiety },
  entities: [[id, species, x, y], ...] }   // every entity on the floor
{ type: "over" }                            // the player died
```

- Entities are flat tuples: the frame stays close to a typed array if it
  ever goes binary.
- `species` is a `SpeciesName` string. Fog of war is out of scope: the
  view shows the whole floor (debug view).
- No events and no death cause in this plan: their `a`/`b` payloads are
  untyped (`docs/ideas.md`).
- Floor size comes from `starter` (`starter.width`, `starter.height`). The
  server reads it for the snapshot and for the move cell index. No
  `world.size()`: nothing loads a game yet.
- `entities` excludes the player, which has its own `player` field.
  Protocol exports `Entity`, one `[id, species, x, y]` tuple. `species` is
  a plain string: protocol imports no workspace package.
- Measured: the largest snapshot over 30 seeds was 873 bytes (39
  entities); the opening is 461 bytes. JSON holds.

### D6. Engine additions (World API, not the frozen module API)

- **Species column.** A saved core column holds each entity's species
  index, set at spawn. It goes into `coreColumns`, gets load checks, bumps
  `FORMAT_VERSION`, and re-pins the golden hash on purpose.
- Species from the component mask was tried and rejected: a mask holds
  registered components only (`lifecycle/species.ts:90-100`). With a
  mechanic removed, species collapse (without fire, cheese and mushroom
  share a mask), and the game must run with any mechanic removed.
- `world.entities(floor, visit: (id, species, x, y) => void)`: visitor, like
  `drainEvents`; no slot leaves the engine. Goes through `checkHealthy`.

### D7. Starter floor

`packages/engine/src/world/` (the "Floor and world generation" row) gets
`starter.ts`. It exports `starter`, a frozen `{ width, height, start,
layout }` (`layout` is a list of `{ species, x, y }`), and
`createStarterGame(seed)`, which builds a one-floor game of that size and
spawns the layout. Building the world inside rules out a size mismatch.
The layout is content replaced by a generator later, not a tuning value,
so it does not go to a `config.ts`. No randomness: the seed still drives
every creature's behaviour. The server reads the size and start cell from
`starter`.

## 3. Not built

Persistence and reconnection; several players per world; fog of war;
events and death cause in the snapshot; binary frames; seeded generation;
`world.size()`; 3D; Eden.

## 4. Slices

Each slice: behaviour + data + seeded test, `bun run verify` green, then a
red-team and a blue-team review of the diff before the next slice. Target
~150 lines of diff per slice.

1. **A session plays moves and ends on death.**
   Files: `packages/protocol/src/index.ts` (schemas `move`, `wait`,
   `snapshot` without `entities`, `over`, `rejected`; row "Message between
   web and server"), `packages/protocol/package.json` (typebox 0.34.52),
   `apps/server/src/session.ts` (row "sessions, hosting the engine"),
   `apps/server/test/session.test.ts`, `CLAUDE.md` (protocol rule),
   `CONTEXT.md` (Command, Session, Snapshot). The player spawns on an empty
   floor, so it starves.
   Tests on the class: a move changes the position by (dx, dy); a wait
   keeps it; a move off the floor edge and a row wrap keep it and still
   play the turn; `{dx:0, dy:0}` is `rejected`; a player that only waits
   gets `over` within a bounded loop, then `rejected` (`over`); same seed
   and commands give the same messages.
2. **The session runs over the WebSocket.**
   Files: `apps/server/src/app.ts`, `apps/server/test/{socket.test,
   client}.ts`; ping/pong goes, with `app.test.ts`.
   Tests (helper `client.ts`: one reply per message, no sleeps): the first
   snapshot arrives on open; a round trip; `{dx: 2}`, an extra key and
   non-JSON each get `rejected` and the next valid command still plays; a
   session that throws closes the socket with 1011 and no `rejected`; two
   connections have independent games.
3. **The engine lists a floor's entities.**
   Files: `packages/engine/src/core/{world,game-world}.ts` (`entities`),
   the species column (core columns, lifecycle, persistence), `src/index.ts`,
   `test/index.types.ts`, tests mirroring `src/`.
   Tests: on `populatedWorld` (`test/fixtures.ts`), run 100 rounds; the ids
   `entities` lists equal the ids alive on the floor, with their species
   and cells, including regrown flora; save + load lists the same; hash
   identical with `entities` called or not; species stay correct in a game
   with a mechanic removed (cheese and mushroom without fire); the
   player's species is reported; a loaded image with an out-of-range
   species index is refused.
4. **A starter floor.** `packages/engine/src/world/starter.ts`,
   `src/index.ts`. Tests: the listed entities equal `starter.layout`; the
   layout fits the floor with the start cell free; `starter` cannot be
   mutated; a seeded run of 200 rounds leaves fewer cheese (cheese never
   regrows, so the count is the eating observable) and rats alive.
5. **The client sees the floor and can eat.** `entities` in the snapshot,
   `createStarterGame` in the session, `eat` command. `FLOOR` and `START`
   leave `session.ts`; it reads `starter`.
   `eat.target` is an integer in [1, 2^31 - 1]; any other id plays as idle
   in the engine (`game-world.ts:81-87`) and never poisons the world.
   Tests: the first snapshot lists the starter layout (creatures may have
   moved one step); a player next to cheese eats it (the cheese leaves the
   snapshot, satiety rises); an `eat` on food 3 cells away moves the player
   one step closer; a stoat kill ends the game with `over` (seed 21); same seed and
   commands give the same snapshots, a different seed differs.
6. **ASCII debug view.** `apps/web/src/debug/` renders a snapshot to text
   (one glyph per species in `apps/web/src/theme.ts`).
   `apps/web/src/input/` maps a key and the last snapshot to a command:
   arrows and hjkl/yubn move, `.` waits, `e` eats the lowest-id food the
   player can eat within one cell. `apps/web/src/main.ts` wires the
   socket: one command in flight at a time, a rejected command shows for
   `rejectedNoticeMs`, and keys stop after `over` or a closed socket.
   Tests (`apps/web/test/`, in the typecheck): render of a fixed snapshot
   gives a fixed string; key → command table; `e` choices; no value import
   from `@korr/protocol` under `apps/web/src/` (only `import type`: an
   inline `type` specifier still loads the module).
   Manual run: `bun run dev`, a WebSocket client through the Vite proxy
   gets a snapshot and plays a move.

Then `/code-review` on the whole branch.

## 5. Closing state

One rat plays the starter floor in the ASCII debug view, through the Vite
proxy, against the authoritative server. Tests: engine 532, server 23,
web 24; `bun run verify` green.

Deviations from the plan as reviewed:
- Species come from a saved core column, not from the component mask. A
  mask holds registered components only: with a mechanic removed, cheese
  and mushroom share one. Cost: `FORMAT_VERSION` 6 -> 7, golden hash
  re-pinned, bench RSS 155 -> 158 MB (budget 160).
- Elysia's `.ws()` `error` hook gets the request context, not the socket.
  It answers validation failures only; `open` and `message` catch their
  own errors and close with 1011.
- `createStarterGame(seed)` builds the world itself, so the layout never
  meets a world of the wrong size.
- The web keeps one command in flight: key repeat would otherwise play
  several turns on a stale snapshot.

Measured: the largest snapshot over 30 seeds is 873 bytes, so JSON holds.

Tight margins: bench RSS 158 of 160 MB; `core/persistence/rows.ts` at 396
of 400 lines.

Observed in play: stoats start at 800 satiety and hunt below 500, so they
ignore the player for about 100 turns (`docs/ideas.md`).

