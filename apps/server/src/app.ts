import { Elysia, t } from "elysia";
import type { GameState } from "./domain/game/state";
import { newGame } from "./domain/game/state";
import { tick } from "./domain/game/tick";

// Wire format for the full game state pushed to the client after every action.
// Mirrors GameState but replaces Uint8Array / readonly tuples with plain,
// JSON-serialisable types.
type Snapshot = {
  type: "state";
  turn: number;
  player: { x: number; y: number };
  level: {
    grid: { width: number; height: number; tiles: number[] };
    spawn: [number, number] | null;
    downStairs: [number, number] | null;
    rooms: Array<{
      x: number;
      y: number;
      w: number;
      h: number;
      doors: Array<[number, number]>;
    }>;
  };
};

function toPair(pt: readonly [number, number]): [number, number] {
  const p: [number, number] = [pt[0], pt[1]];
  return p;
}

function toSnapshot(state: GameState): Snapshot {
  const { level, player, turn } = state;
  return {
    type: "state",
    turn,
    player: { x: player.x, y: player.y },
    level: {
      grid: {
        width: level.grid.width,
        height: level.grid.height,
        tiles: Array.from(level.grid.tiles),
      },
      spawn: level.spawn === null ? null : toPair(level.spawn),
      downStairs: level.downStairs === null ? null : toPair(level.downStairs),
      rooms: level.rooms.map((r) => ({
        x: r.x,
        y: r.y,
        w: r.w,
        h: r.h,
        doors: r.doors.map(toPair),
      })),
    },
  };
}

const TCoords = t.Tuple([t.Number(), t.Number()]);

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
]);

const responseSchema = t.Object({
  type: t.Literal("state"),
  turn: t.Number(),
  player: t.Object({ x: t.Number(), y: t.Number() }),
  level: t.Object({
    grid: t.Object({
      width: t.Number(),
      height: t.Number(),
      tiles: t.Array(t.Number()),
    }),
    spawn: t.Union([t.Null(), TCoords]),
    downStairs: t.Union([t.Null(), TCoords]),
    rooms: t.Array(
      t.Object({
        x: t.Number(),
        y: t.Number(),
        w: t.Number(),
        h: t.Number(),
        doors: t.Array(TCoords),
      }),
    ),
  }),
});

export function createApp() {
  const sessions = new Map<string, GameState>();

  return new Elysia()
    .get("/health", () => ({ ok: true }))
    .ws("/game", {
      body: bodySchema,
      response: responseSchema,
      open(ws) {
        const state = newGame(Date.now(), "rim");
        sessions.set(ws.id, state);
        ws.send(toSnapshot(state));
      },
      message(ws, action) {
        const state = sessions.get(ws.id);
        if (state === undefined) return;
        const next = tick(state, action);
        sessions.set(ws.id, next);
        ws.send(toSnapshot(next));
      },
      close(ws) {
        sessions.delete(ws.id);
      },
    });
}

export type App = ReturnType<typeof createApp>;
