import { Elysia, t } from "elysia";
import { type GameState, newGame, tick, zoneId } from "./domain/game/index";
import { responseSchema, toSnapshot } from "./snapshot";

const bodySchema = t.Union([
  t.Object({
    type: t.Literal("MOVE"),
    dir: t.Union([
      t.Literal("n"),
      t.Literal("e"),
      t.Literal("s"),
      t.Literal("w"),
    ]),
  }),
  t.Object({
    type: t.Literal("WAIT"),
  }),
  t.Object({
    type: t.Literal("ENTER_ZONE"),
    zone: t.Number(),
  }),
]);

export function createApp() {
  const sessions = new Map<string, GameState>();

  // permessage-deflate: the snapshot JSON is dominated by `255,255,…` runs
  // (fog) and compresses ~97% (9.6 KB → ~240 B, measured 2026-06). The
  // constructor option only NEGOTIATES the extension — outgoing frames are
  // compressed per send, via the second argument to `ws.send`. A send site
  // that forgets the flag silently ships uncompressed.
  return new Elysia({ websocket: { perMessageDeflate: true } })
    .get("/health", () => ({ ok: true }))
    .ws("/game", {
      body: bodySchema,
      response: responseSchema,
      open(ws) {
        const state = newGame(Date.now(), "rim");
        sessions.set(ws.id, state);
        ws.send(toSnapshot(state), true);
      },
      message(ws, action) {
        const state = sessions.get(ws.id);
        if (state === undefined) return;
        // Game over: drop inbound actions on the floor. The client already
        // has the terminal snapshot (the one that flipped `gameOver` to
        // true); re-emitting the same payload on every keystroke would be
        // noise. The state machine stays frozen until the connection
        // closes.
        if (state.gameOver) return;
        // Trust boundary: `bodySchema` proves the inbound zone is a number, not
        // that it's a real zone key. Brand it here — the one transport edge
        // where an untrusted client number becomes a domain `ZoneId` — so the
        // game layer below never handles an unbranded zone.
        const next = tick(
          state,
          action.type === "ENTER_ZONE"
            ? { ...action, zone: zoneId(action.zone) }
            : action,
        );
        sessions.set(ws.id, next);
        ws.send(toSnapshot(next), true);
      },
      close(ws) {
        sessions.delete(ws.id);
      },
    });
}

export type App = ReturnType<typeof createApp>;
