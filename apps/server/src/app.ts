import { Elysia, t } from "elysia";

// Builds the Elysia app without starting a listener. Pure constructor — safe
// to import from tests for in-memory request handling via `app.handle(req)`.
// The listener is the responsibility of `index.ts`.
export function createApp() {
  return new Elysia()
    .get("/health", () => ({ ok: true }))
    .ws("/game", {
      body: t.Object({
        type: t.String(),
        at: t.Optional(t.Number()),
      }),
      response: t.Union([
        t.Object({ type: t.Literal("hello"), id: t.String() }),
        t.Object({ type: t.Literal("echo"), received: t.Unknown() }),
      ]),
      open(ws) {
        ws.send({ type: "hello", id: ws.id });
      },
      message(ws, message) {
        ws.send({ type: "echo", received: message });
      },
    });
}

export type App = ReturnType<typeof createApp>;
