# Plan: the web 3D client (v1, approved 2026-10-16)

Inputs: a /brainstorm in four sections (layers, animation timeline, errors,
tests), each investigated by a researcher and an advisor, reviewed by a red
team, a blue team and Codex, then approved by the user (2026-10-15/16).

## 1. Success criterion

A person runs `bun run dev`, opens the page and plays the rat in a 3D scene:
an orthographic camera follows the player, every turn animates, the HUD shows
HP and satiety, and a lost link or a bug ends on one end screen with "New
game". `?debug` shows the ASCII view instead. `bun run verify` and
`bun run e2e` are green.

## 2. Fixed context

- Rewrite `apps/web` from zero. The current `src/` and `test/` are a
  behaviour reference only (key bindings, eat-target rule, glyphs), deleted
  in slice 1.
- Three.js `three` 0.186.1 (`three/webgpu`, TSL), `WebGPURenderer` with its
  automatic WebGL2 fallback. Orthographic camera following the player. No
  pixel mode. Out of scope: vision, terrain memory, relief.
- The TS server (Elysia) and the protocol are unchanged, except `SEED` in
  `apps/server/src/main.ts` and a schema check in `socket.test.ts`.
- The client imports only types from `@korr/protocol` (`import type`).
- No UI framework: the HUD is plain DOM.

## 3. Layers

A layer imports only what its row lists. Enforced by
`scripts/check-architecture.ts` (one web layer matrix, resolved paths for
relative imports, raw specifiers for packages, with probes that must fire).

Pure core, typechecked by `apps/web/tsconfig.pure.json` (`lib: ["ES2022"]`,
`types: []`), so DOM and Bun globals do not compile there. A grit rule on
these three folders bans `Date` and `Math.random`.

| Layer | Role | Imports |
|---|---|---|
| `play/` | `step(play, event)` → `{ play, send }`: status machine, one command in flight, gesture queue, gesture → command, notice | protocol (type) |
| `view/` | `deriveView(prev, next)` → `Timeline`; `sample`; `playback.ts` `frame`; `easing.ts` | protocol (type) |
| `input/` | `gestureOf(press)` → `Gesture \| undefined`; binding table as data | play (type) |

Adapters and consumers: removable, never import each other.

| Layer | Role | Imports |
|---|---|---|
| `net/` | `connect(open, onEvent, config)` → `{ send, close }`; `decode.ts`; watchdogs in `net/config.ts` | play (type), protocol (type) |
| `render/` | `createScene(canvas, options)`, async; one file per subject: floor, entities, player, camera rig | view (type), play (type), theme, three |
| `ui/` | HUD | play (type), theme |
| `debug/` | ASCII view | view (type), play (type), theme |

Composition.

| Layer | Role | Imports |
|---|---|---|
| `app/client.ts` | consumer list, frame loop, clock; the only mutable state; testable with fakes | all but `app/main.ts` |
| `app/main.ts` | Vite entry: DOM lookups, `?debug`, `?webgl`, end screen, `error`/`unhandledrejection` | all |
| `theme.ts` | values: one row per `Look.stem` (glyph, shape, colour) + unknown fallback, palette, `motion.turnMs`, `endTexts`, notice texts | — |

Rules: no store, no signals, no hidden global state. Consumers keep caches
rebuilt from frames. `app` pushes `show(frame)` on change and `draw(poses)` on
every animation frame. A new consumer is one line in the consumer list; a new
species is one `theme.ts` row.

## 4. Types (the contracts every slice shares)

```ts
// play/
type Gesture = { kind: "move"; dx: -1 | 0 | 1; dy: -1 | 0 | 1 } | { kind: "wait" } | { kind: "eat" };
type Ending =
  | { kind: "over" }
  | { kind: "lost"; cause: "unreachable" | "dropped"; detail: string }
  | { kind: "broken"; detail: string };
type PlayEvent =
  | { type: "open" }
  | { type: "message"; message: ServerMessage }
  | { type: "closed"; detail: string }
  | { type: "fault"; detail: string }
  | { type: "gesture"; gesture: Gesture }
  | { type: "settled" };
type Play = {
  status: "connecting" | "playing" | Ending;
  opened: boolean;              // the socket opened: decides unreachable vs dropped
  snapshot: Snapshot | undefined;
  inFlight: boolean;
  notice: string | undefined;   // until the next server message, no timer
  queued: Gesture | undefined;  // slice 3
  settled: boolean;             // slice 3
};
step(play: Play, event: PlayEvent): { play: Play; send: Command | undefined };

// input/ — DOM field names, so a KeyboardEvent fits structurally
type KeyPress = { key: string; code: string; repeat: boolean; ctrlKey: boolean;
  altKey: boolean; metaKey: boolean; isComposing: boolean; keyCode: number };

// view/
type Spot = { x: number; y: number; opacity: 0 | 1 };
type Track = { id: number; look: Look; from: Spot; to: Spot };
type Timeline = { width: number; height: number; player: Track; tracks: readonly Track[] };
type Pose = { id: number; look: Look; x: number; y: number; opacity: number };
type Poses = { width: number; height: number; player: Pose; entities: readonly Pose[] };
deriveView(prev: Snapshot | undefined, next: Snapshot): Timeline;
sample(timeline: Timeline, t: number): Poses;          // t in [0, 1], already eased
type Playback = { duration: number; start: number | undefined };
frame(playback: Playback, now: number): { playback: Playback; progress: number };

// app/
type Frame = { play: Play; timeline: Timeline | undefined };
type Consumer = { show(frame: Frame): void; draw?(poses: Poses): void };
type Link = { send(command: Command): void; close(): void };
createClient(options: {
  connect: (onEvent: (event: PlayEvent) => void) => Link;
  consumers: Consumer[];
  ended: (ending: Ending) => void;
  requestFrame: (callback: (now: number) => void) => () => void;  // returns cancel
  turnMs: number;               // 0 under prefers-reduced-motion
}): { receive(event: PlayEvent): void; press(press: KeyPress): boolean; replace(from: Consumer, to: Consumer): void };
// press returns true when the key is bound, so main.ts calls preventDefault.
```

The snapshot's player carries no species, so the player track's look is the
constant `{ stem: "player", tier: 0 }`, and `theme` holds a `player` row.

## 5. Decisions

### Pacing and animation (section 2)

1. One snapshot per command. One shared progress per turn for every track.
   Present in both snapshots: slides. Outgoing: keeps its pose and its look
   from `prev.looks`, opacity 1 → 0. Incoming: 0 → 1. First snapshot: from =
   to. The end state is `sample(timeline, 1)`: no second copy.
2. Duration `theme.motion.turnMs` ≈ 120, independent of creature count. One
   easing, outCubic, as code in `view/easing.ts`. `prefers-reduced-motion:
   reduce` → duration 0. `frame`: start taken on the first frame; duration 0
   → progress 1 (no division); progress clamps at 1. Only rAF timestamps feed
   the clock.
3. Pacing, one rule in `play/`: a gesture is sent only when no command is in
   flight AND the last turn has settled; otherwise it is queued, latest wins.
   `app/` steps `settled` on the first frame where progress reaches 1; the
   queued gesture then resolves against the newest snapshot and is sent.
4. Flush: on a snapshot, the queued gesture is discarded when the player's HP
   dropped, or it is a move into a cell held by an entity that blocks `step`
   and is not edible (which entities block: read `turn.ts` in the
   investigation), or an eat with no target. Rejected, over, lost and broken
   also clear the queue.
5. Keys by `key`: arrows, `h j k l y u b n`, `e`, `.` (works on AZERTY with
   Shift). Plus `code` `Numpad1`–`Numpad9` whatever NumLock says, `Numpad5` =
   wait. Shift allowed; Ctrl, Alt, Meta rejected; IME ignored (`isComposing`
   or keyCode 229); repeats dropped by `event.repeat`. `gestureOf` is
   stateless.
6. Eat target: the lowest id among edible entities (`play/edible.ts`, copied
   diet: cheese, mushroom) at Chebyshev distance ≤ 1; none → no command.
7. HUD values apply on message arrival. The HUD never shows "game over".

### Errors (section 3)

8. An ending is final: every later event is ignored, the first detail kept.
9. `closed` before the socket opened → `lost/unreachable`; after →
   `lost/dropped`. The detail is the close code or "no reply". `closed` comes
   from a socket close, an expired watchdog, or `pageshow` with `persisted`
   (bfcache restore, sent by `main.ts` through `receive`).
10. `fault` → `broken`: undecodable frame, unknown `type` or `reason`,
    `rejected: over` while playing, any throw in `app/`. `rejected: invalid`
    is not fatal: notice, queue cleared, the sent command logged with
    `console.error` in `app/`.
11. Every throw is `broken`. `app/` builds the broken ending directly, without
    calling `step`, so a bug in `step` cannot loop. On an ending, `app/`
    cleans up once: cancels the rAF, closes the link, calls `ended(ending)`.
    `main.ts` listens to `error` and `unhandledrejection` and ends as broken.
12. One end screen, written by `main.ts` with `textContent` into a fixed
    element: title from `theme.endTexts` (over, unreachable, dropped, broken),
    the detail line (selectable), and "New game" (button, Enter too) →
    `location.reload()`. Never auto-reload, never auto-reconnect.
13. Watchdogs in `net/` (`net/config.ts`: `openMs` ≈ 15000, `replyMs` ≈
    10000). `openMs` armed at `connect`, cleared by the first message;
    `replyMs` armed by `send`, cleared by any message. Expiry → `closed`
    "no reply". A page hidden at any point since the timer was armed gets a
    fresh budget instead of expiring.
14. Decoder `net/decode.ts`: strict on every field the client reads, extra
    fields ignored. `type` in `snapshot | over | rejected`; `reason` in
    `invalid | over`; integers are safe integers; ids in the `Eat.target`
    range [1, 2^31 − 1]; entity tuples of length 4; `looks` values with a
    string `stem` and integer `tier` ≥ 0. Invalid JSON or a non-object →
    failure.
15. Render loss: `createScene` assigns `onDeviceLost` and `onError` before
    `init()`. A loss during `init()` makes `createScene` return a failure,
    and `main.ts` falls back to the ASCII view. Afterwards, a loss or an
    uncaptured GPU error calls the `lost` callback once; `main.ts` then calls
    `replace(scene, ascii)`, which shows the current frame at once and is a
    no-op the second time. No device recovery. Reporting: `console.error`.

### Tests (section 4)

16. Unit tests in bun, inside `verify`, each naming its bug (lists per slice).
17. E2E in a workspace `apps/e2e` (`@korr/e2e`), Playwright under Node,
    files `apps/e2e/test/*.e2e.ts` (`testMatch: "**/*.e2e.ts"`), no `test`
    script in the package. Root script
    `"e2e": "turbo run build --filter=@korr/web && bun run --cwd apps/e2e e2e"`.
    No turbo `e2e` task, no git hook. Not in `verify`: `bun run e2e` is
    required in the verify notes of every slice touching `apps/web`,
    `apps/server`, `packages/protocol` or `packages/engine`. It moves into
    `verify` once it takes ≤ 10 s and passes 20 runs in a row.
18. Hermetic hosts: `SEED` env (unset → omitted; not an integer → throw at
    startup); ports from a hash of the checkout path;
    `vite preview --strictPort` with the proxy target from
    `KORR_SERVER_PORT` (default 3000); `reuseExistingServer: false`; server
    readiness by `wait` on "server listening".
19. Determinism: fixed seed, `reducedMotion: "reduce"`, viewport 800×600,
    `deviceScaleFactor: 1`, `--use-angle=swiftshader-webgl`; waits on DOM
    state or wire frames only; `retries: 0`, `forbidOnly`.
20. Observable seams: `?webgl` → `forceWebGL`; `render/` writes the backend
    that ran to `data-backend` (read from the backend object:
    `isWebGPURenderer` stays true under `forceWebGL`) and increments
    `data-frames` after each `renderer.render`. "Drawn" = `data-frames`
    advanced twice after the snapshot reached the page.
21. The wire is the oracle: the `routeWebSocket` tap is installed before
    navigation, forwards both directions itself (an `onMessage` handler stops
    automatic forwarding) and records every frame. No case closes during a
    command in flight (the mock's `send()` throws there).
22. Pixel probe: after "drawn", a 1×1 `page.screenshot({ clip })` at the
    canvas centre is not the clear colour (from `@korr/web/theme`). The player
    colour is never compared: lighting scales it.
23. Manual per slice (verify notes): WebGPU on a real GPU through the browser
    MCP; `kill -9` the server mid-game; start with the server down; DevTools
    bfcache test.

## 6. Slices

Every slice: an investigation (researcher + advisor) before its brief,
tests written first and seen failing, an opus review of its diff after
implementation, `bun run verify` green, and the `comment-cleanup` skill on
the diff before commit.

### Slice 1 — Walking skeleton: the ASCII client in the new layers

- Files: delete `apps/web/src/**`, `apps/web/test/**`. Create
  `apps/web/src/{play/{types,step,edible}.ts, input/keys.ts, net/{connect,decode}.ts,
  debug/ascii.ts, ui/hud.ts, app/{client,main}.ts, theme.ts}`,
  `apps/web/tsconfig.pure.json`, `apps/web/test/**` mirroring `src/`,
  `apps/web/index.html`. Edit `scripts/check-architecture.ts`, `biome.json`,
  `scripts/lint/web-purity.grit`, `turbo.json`, `apps/web/package.json`,
  `CLAUDE.md`, `CONTEXT.md`.
- Structure: the layer matrix, the `step` state machine, the `Consumer`
  push, `createClient`.
- Approach: the game plays as today in the ASCII view: one command in
  flight, a gesture while in flight is dropped (queue arrives in slice 3),
  no timeline (`Frame.timeline` undefined, no `draw`), `debug/` renders the
  snapshot directly. `net/decode.ts` is strict as in decision 14 from the
  start. Errors: endings and the end screen are slice 2; here a close shows
  a plain status line in the HUD.
- Contract: types of §4 (fields marked slice 3 absent). Bindings and eat rule
  of decisions 5–6 (Numpad, IME and modifier rules included). Glyphs:
  rat r, stoat s, cheese %, mushroom ", moss ~, ember *, stairs >, unknown ?,
  player @, floor `.`; tier > 0 → uppercase. Check-architecture: the web
  matrix of §3, `@korr/protocol` only through `import type`/`export type`
  (`import { type X }` refused), consumers import `view/` and `play/` as
  types only; a probe per rule that must fire. `tsconfig.pure.json` joins the
  web `typecheck` script. Grit rule `web-purity.grit` through a `biome.json`
  override on `apps/web/src/{play,view,input}/**`, with an allowed and a
  forbidden sample like `determinism.grit`. Turbo: `typecheck` and `test`
  depend on `^typecheck` (exact form from `node_modules/turbo/docs/`), so a
  `@korr/protocol` edit invalidates the web's cached tests. CLAUDE.md: the
  web rows of §3 replace the four current web rows, and a row
  "Browser end-to-end tests (`bun run e2e`, not part of `verify`) |
  `apps/e2e/`". CONTEXT.md: **Gesture** (what the player asks for, before it
  becomes a `Command`) and **Play** (the client's state of one game).
- Risk: high (the seams every later slice builds on).
- Verification: `bun run verify` exits 0 with these new tests failing first:
  - play: snapshot then gesture → one command; second gesture while in
    flight → none (two commands in flight); eat picks the lowest adjacent
    edible id, none → no command (target read from stale snapshot);
    `rejected: invalid` → notice until the next server message.
  - input: repeat, Ctrl/Alt/Meta and IME dropped; Shift + `.` and NumLock-off
    `Numpad4` bound (AZERTY wait unbound).
  - net: decoder accepts a typed sample of each message
    (`satisfies ServerMessage`), rejects each case of decision 14.
  - debug: A1, a non-square floor with an unknown stem, cell by cell, glyphs
    read from `theme` (x/y swapped, fallback missing).
  - app: each consumer removed in turn, the game still advances (fake link).
  - check-architecture: each probe fires (a layer rule silently disabled).
  - Manual: `bun run dev`, play five turns in the ASCII view.

### Slice 2 — Error dimension: endings, watchdogs, end screen

- Files: `apps/web/src/play/step.ts`, `apps/web/src/net/{connect,config}.ts`,
  `apps/web/src/app/{client,main}.ts`, `apps/web/src/theme.ts`,
  `apps/web/index.html`, tests; `apps/server/test/socket.test.ts`.
- Structure: `Ending` and the cleanup path.
- Approach: decisions 8–14.
- Contract: as in §4 and decisions 8–14. `connect(open: () => WebSocketLike,
  onEvent, config: { openMs; replyMs })`, `WebSocketLike` the structural
  subset of `WebSocket` it uses. Visibility comes from a
  `hidden: () => boolean` and a `visible` subscription passed in config, so
  tests fake it.
- Risk: high.
- Verification: `bun run verify` exits 0 with these tests failing first:
  - play: over then closed stays over, broken keeps its first detail;
    closed before open → unreachable, after open (1011 or 1006) → dropped;
    `rejected: over` while playing → broken.
  - net (fake socket, fake timers): garbled frame → `fault`; send then no
    reply → `closed` after `replyMs`, send then reply → nothing; no first
    message → `closed` after `openMs`; expiry after a hidden period re-arms,
    a reply then clears it.
  - app: a table over the throw sites `show`, `draw` (when present) and the
    pure computation → exactly one `ended(broken)`, nothing more sent, rAF
    cancelled; a `step` that always throws still yields exactly one
    `ended(broken)`.
  - server: every message received in `socket.test.ts` passes
    `Value.Check(ServerMessage, m)`.
  - Manual: `kill -9` the server mid-game → "dropped"; start with the server
    down → "unreachable"; DevTools bfcache test; "New game" and Enter reload.

### Slice 3 — Time dimension: timeline, playback, pacing

- Files: `apps/web/src/view/{derive,sample,playback,easing}.ts`,
  `apps/web/src/play/step.ts` (queue, settled, flush),
  `apps/web/src/app/client.ts` (rAF loop), tests.
- Structure: `Timeline`, `Playback`, the pacing rule.
- Approach: decisions 1–4. `debug/` keeps `show` only; `draw` arrives with
  the scene. The app sequences: on a message, `step`; if the snapshot
  changed, `timeline = deriveView(prev, next)`, `playback = { duration:
  turnMs, start: undefined }`; commit, `show`, send if any. On rAF: `frame`,
  `draw(sample(timeline, ease(progress)))` to every consumer with `draw`; if
  progress is 1 and the turn has not settled, `step(settled)`, commit, send
  if any.
- Contract: §4 types, decisions 1–4.
- Risk: high.
- Verification: `bun run verify` exits 0 with these tests failing first:
  - view: `sample(t, 0)` = prev poses and `sample(t, 1)` = next poses;
    reordered entity arrays still pair by id; one midpoint test over an
    entity and the player (no interpolation, player forgotten); outgoing
    keeps its prev look and is gone at 1; first snapshot from = to.
  - playback: start on first frame, progress clamps at 1; duration 0 on its
    first frame gives 1, not NaN; easing 0 → 0, 1 → 1.
  - play: gesture during an unsettled turn is queued and sent on `settled`;
    latest queued wins; queued eat resolves against the new snapshot, no
    target → discarded; HP drop and blocked move flush; rejected, over,
    lost, broken clear the queue.
  - app (fake link, fake rAF): three presses, each made after the previous
    reply and its settle frame → three commands in order; a `deriveView`
    throw joins slice 2's throw table.

### Slice 4 — Second consumer of `draw`: the Three.js scene

- Files: `apps/web/src/render/{scene,floor,entities,player,camera}.ts`,
  `apps/web/src/theme.ts` (shape and colour per stem, palette),
  `apps/web/src/app/main.ts` (scene first, ASCII on failure or `?debug`,
  `replace` on loss), `apps/web/package.json` (`three` 0.186.1,
  `@types/three` 0.186.0), tests.
- Structure: `createScene(canvas, { forceWebGL, lost }) →
  Promise<{ ok: true; scene: Consumer } | { ok: false; detail: string }>`.
- Approach: decision 15. Flat floor tiles, one simple shape per species, the
  player; orthographic camera centred on the player's sampled pose, driven
  only by `sample()` with no damping. The investigation checks whether
  `three/webgpu` imports in bun without a DOM (a Node-globals fix exists,
  three PR #29919) and how to read the backend that ran.
- Contract: §4 types, decision 15. A mesh cache keyed by entity id, rebuilt
  from frames; departed entities' geometry and material disposed.
- Risk: high (device loss, a new dependency).
- Verification: `bun run verify` exits 0 with, only if `three/webgpu`
  imports in bun:
  - R1: over many turns, after the draw at progress 1, the visible drawables
    equal live entities plus the player (outgoing meshes never removed,
    player never added).
  - R2: `new Vector3(...).project(camera)` puts x+1 to the right and y+1
    below (axis flip).
  - app: `replace` shows the current frame on the ASCII view at once; a
    second `replace` is a no-op.
  - Manual: WebGPU on a real GPU through the browser MCP; force a loss with
    `WEBGL_lose_context` under the WebGL fallback → ASCII view.

### Slice 5 — Browser end-to-end

- Files: `apps/e2e/{package.json,tsconfig.json,playwright.config.ts}`,
  `apps/e2e/test/{game,context-loss}.e2e.ts`, `apps/e2e/test/{wire,probe}.ts`,
  `apps/server/src/main.ts` (`SEED`), `apps/web/vite.config.ts` (proxy target
  from `KORR_SERVER_PORT`), `apps/web/package.json` (export `./theme`),
  `apps/web/src/app/main.ts` (`?webgl`), `apps/web/src/render/scene.ts`
  (`data-backend`, `data-frames`), root `package.json` (`e2e`), `.gitignore`
  (`test-results/`, `playwright-report/`), `scripts/check-architecture.ts`
  (walk `apps/e2e`; it may import only `@korr/web/theme` and
  `@korr/protocol` types), `CLAUDE.md` Commands
  (`bunx playwright install chromium-headless-shell`).
- Structure: the e2e workspace and its wire tap.
- Approach: decisions 17–22. Open in the investigation: does
  `webServer.env` merge with `process.env`; does `wait` read stdout; does
  Chromium accept `--use-angle=swiftshader-webgl`.
- Contract: decisions 17–22.
- Risk: low.
- Verification: `bun run e2e` exits 0 and `bun run verify` exits 0, with:
  - T1, in `test.step`s: boot (`data-backend` = webgl, no `pageerror`, no
    console error until the drop, HUD = opening snapshot's HP and satiety);
    a press, drawn, a second press, drawn → exactly two commands and two
    snapshots on the wire, HUD = the last one, satiety changed, the probe
    passes; the tap closes with 1011 → "dropped" end screen, click "New game"
    → a second socket, drop again, Enter → a third socket.
  - T2: start from a working scene (`data-backend` = webgl, `data-frames`
    advancing); require `WEBGL_lose_context`, `loseContext()` → ASCII view
    at once with the player glyph at the last snapshot's cell; a press → one
    command and the glyph moves to the new cell; the only console error
    allowed is the device-loss log.
  - Injected bug check: break the HUD wiring or remove the `lost` callback,
    see T1 or T2 fail, revert.

## 7. To docs/ideas.md (written in slice 1)

- Mouse picking (`render` exports `cellAt`, `app` hands the cell to `input`).
- Eating generated food species.
- Unprompted server snapshots (need a sequence number).
- Held-key walking at a fixed cadence.
- Attack and bite animations, HUD at the hit: need events in the protocol.
- A snapshot (or final HP) on `Over`.
- Floor identity in the snapshot, once the player can change floor.
- An application heartbeat in the protocol.
- Reconnect to a held game.
- The Rust server must send WebSocket pings.
- Shared protocol fixtures and a JSON Schema export, once the Rust server
  speaks the protocol.
- Telemetry for broken reports.
- CI running `verify` and `e2e` on Linux.
- An automated WebGPU check on a host with a real adapter.
- A git hook running `e2e` once it is fast and stable, or straight into
  `verify`.

## 8. Deviations

Slice 1:
- §4 fields unread in slice 1 are absent (`opened`, the `open` event,
  `detail`, `Frame.timeline`, `draw`, `Link.close`, the extra `createClient`
  members); each arrives with the slice that reads it.
- `notice` is a key union (`rejected | closed | fault`) looked up in
  `theme.noticeTexts`, not a string.
- The HUD shows the over text until slice 2's end screen replaces it.
- `apps/web/test/protocol-imports.test.ts` is gone: `check-architecture.ts`
  enforces type-only protocol imports, including type-position `import()`.
- `scripts/check-web-purity.ts` (in `check:arch`) proves biome loads
  `web-purity.grit`: `determinism.grit` had no sample harness to copy.

Slice 2:
- `Notice` keeps only `rejected`: closed and faults are endings now, so the
  `closed` and `fault` keys had no writer left.
- `config.visible` is named `onVisible`: it takes a listener.
- `createClient` takes `ended` and returns `receive`; `requestFrame`,
  `turnMs` and `replace` arrive with slices 3 and 4. No rAF to cancel yet.
- One watchdog timer serves both budgets: the first message clears the open
  budget and a command is only sent after it, so they never overlap.
- A hidden period's fresh budget runs from the moment the page turns
  visible again (`onVisible` re-arms); an expiry while still hidden re-arms.
- `main.ts` turns `error` and `unhandledrejection` into
  `receive({ type: "fault" })`, so they take the same single cleanup path.
- Details not fixed by decision 9: `rejected: over` for that message,
  `undecodable server message` for a bad frame, `restored from the
  back-forward cache` for `pageshow`.
- `app/` also logs every caught throw with `console.error`, so a broken
  ending keeps its stack trace.
- The end screen title is a `<p>`: Biome refuses an empty heading.
- `apps/server` declares `@sinclair/typebox` (the version `@korr/protocol`
  pins) as a dev dependency for `Value.Check`.
