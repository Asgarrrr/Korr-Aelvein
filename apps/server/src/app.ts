import { Elysia, t } from "elysia";
import { getComponent } from "./domain/ecs/index";
import type { GameState } from "./domain/game/state";
import { newGame } from "./domain/game/state";
import { tick } from "./domain/game/tick";

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
  t.Object({
    type: t.Literal("WAIT"),
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

// Single source of truth: the wire-format TS type is derived from the
// TypeBox response schema (`typeof schema.static`). Schema and TS type
// can no longer drift.
type Snapshot = typeof responseSchema.static;

function toPair(pt: readonly [number, number]): [number, number] {
  return [pt[0], pt[1]];
}

function toSnapshot(state: GameState): Snapshot {
  const { level, world, playerId, turn } = state;
  const pos = getComponent(world, playerId, "position");
  if (pos === undefined) {
    throw new Error("toSnapshot: player entity has no position component");
  }
  return {
    type: "state",
    turn,
    player: { x: pos.x, y: pos.y },
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
