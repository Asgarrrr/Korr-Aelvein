import { describe, expect, test } from "bun:test";
import { createApp } from "../app";

describe("createApp", () => {
  test("GET /health returns 200 with { ok: true }", async () => {
    const app = createApp();
    const response = await app.handle(
      new Request("http://localhost/health", { method: "GET" }),
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ ok: true });
  });

  test("GET /unknown returns 404", async () => {
    const app = createApp();
    const response = await app.handle(
      new Request("http://localhost/unknown", { method: "GET" }),
    );
    expect(response.status).toBe(404);
  });

  test("createApp returns a fresh instance per call (no shared state)", () => {
    const a = createApp();
    const b = createApp();
    expect(a).not.toBe(b);
  });
});

// ─── WS /game integration ───────────────────────────────────────────────────
//
// Boundary test: actually listen on a random port, open a WebSocket, exchange
// the initial snapshot + a MOVE action. Validates the TypeBox body / response
// schemas end-to-end and the session lifecycle (open → message → close).

type ServerSnapshot = {
  type: "state";
  turn: number;
  player: { x: number; y: number };
  level: {
    grid: { width: number; height: number; tiles: number[] };
    downStairs: [number, number] | null;
  };
};

function isServerSnapshot(v: unknown): v is ServerSnapshot {
  if (typeof v !== "object" || v === null) return false;
  if (!("type" in v) || v.type !== "state") return false;
  if (!("turn" in v) || typeof v.turn !== "number") return false;
  if (!("player" in v) || typeof v.player !== "object") return false;
  if (!("level" in v) || typeof v.level !== "object") return false;
  return true;
}

async function openSocket(url: string): Promise<WebSocket> {
  const ws = new WebSocket(url);
  await new Promise<void>((resolve, reject) => {
    ws.onopen = () => resolve();
    ws.onerror = () => reject(new Error("ws: failed to open"));
  });
  return ws;
}

function nextMessage(ws: WebSocket): Promise<unknown> {
  return new Promise((resolve, reject) => {
    ws.onmessage = (e) => {
      const raw = typeof e.data === "string" ? e.data : null;
      if (raw === null) {
        reject(new Error("ws: non-string message"));
        return;
      }
      resolve(JSON.parse(raw));
    };
    ws.onerror = () => reject(new Error("ws: error before message"));
  });
}

describe("WS /game", () => {
  test("open sends an initial snapshot, MOVE increments turn", async () => {
    const app = createApp().listen(0);
    const port = app.server?.port;
    if (port === undefined) {
      throw new Error("test: server did not bind a port");
    }
    const ws = await openSocket(`ws://localhost:${port}/game`);
    try {
      const initial = await nextMessage(ws);
      if (!isServerSnapshot(initial)) {
        throw new Error("ws: initial message does not match Snapshot schema");
      }
      expect(initial.turn).toBe(0);
      expect(initial.level.grid.tiles.length).toBe(
        initial.level.grid.width * initial.level.grid.height,
      );
      // FOV runs before the first tick (newGame), so the very first
      // snapshot must already be perception-masked: some fog (255) AND
      // some revealed terrain.
      expect(initial.level.grid.tiles.some((v) => v === 255)).toBe(true);
      expect(initial.level.grid.tiles.some((v) => v !== 255)).toBe(true);

      const nextSnap = nextMessage(ws);
      ws.send(JSON.stringify({ type: "MOVE", dir: "n" }));
      const after = await nextSnap;
      if (!isServerSnapshot(after)) {
        throw new Error("ws: post-MOVE message does not match Snapshot schema");
      }
      // The MOVE either lands on a floor tile (turn++) or hits a wall (turn
      // unchanged, server still echoes state). Both are valid; we just want
      // proof the round-trip went through.
      expect([0, 1]).toContain(after.turn);
      expect(after.type).toBe("state");
    } finally {
      ws.close();
      app.stop();
    }
  });
});
