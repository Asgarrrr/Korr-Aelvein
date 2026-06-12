import { Elysia, t } from "elysia";
import { forQuery, getComponent } from "./domain/ecs/index";
import {
  activeZoneStatus,
  type GameState,
  newGame,
  tick,
} from "./domain/game/index";

const TCoords = t.Tuple([t.Number(), t.Number()]);

/**
 * Wire sentinel for a tile the player has never seen. Lives here, not in
 * the dungeon domain — `Tile` stays `0 | 1 | 2`; 255 exists only on the
 * wire. The client renders it as blank space (`apps/client/src/render.ts`).
 */
const TILE_UNSEEN = 255;

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

export const responseSchema = t.Object({
  type: t.Literal("state"),
  turn: t.Number(),
  gameOver: t.Boolean(),
  activeZone: t.Number(),
  zones: t.Array(t.Number()),
  player: t.Object({
    x: t.Number(),
    y: t.Number(),
    hp: t.Object({ current: t.Number(), max: t.Number() }),
  }),
  mobs: t.Array(
    t.Object({
      x: t.Number(),
      y: t.Number(),
      glyph: t.String(),
    }),
  ),
  // Perception-filtered (Phase 7): `tiles` ships TILE_UNSEEN for never-seen
  // cells, `downStairs` stays null until its tile has been seen. `spawn`
  // and `rooms` were removed outright — the client never consumed them and
  // both leaked level layout the player hadn't earned.
  level: t.Object({
    grid: t.Object({
      width: t.Number(),
      height: t.Number(),
      tiles: t.Array(t.Number()),
    }),
    downStairs: t.Union([t.Null(), TCoords]),
  }),
});

// Single source of truth: the wire-format TS type is derived from the
// TypeBox response schema (`typeof schema.static`). Schema and TS type
// can no longer drift.
export type Snapshot = typeof responseSchema.static;

function toPair(pt: readonly [number, number]): [number, number] {
  return [pt[0], pt[1]];
}

export function toSnapshot(state: GameState): Snapshot {
  const { playerId, turn, gameOver } = state;
  const zone = activeZoneStatus(state);
  const { world, level, seen, visible } = zone;
  const pos = getComponent(world, playerId, "position");
  if (pos === undefined) {
    throw new Error("toSnapshot: player entity has no position component");
  }
  const hp = getComponent(world, playerId, "hp");
  if (hp === undefined) {
    throw new Error("toSnapshot: player entity has no hp component");
  }
  const mobs: Array<{ x: number; y: number; glyph: string }> = [];
  // `ai` filter excludes the player (who has no AI component) — no need
  // for an explicit "not the player" check. Only mobs inside the current
  // FOV ship; memory (`seen`) shows terrain, never entities.
  forQuery(world, ["position", "actor", "ai"], (_handle, view) => {
    const p = view.position;
    const a = view.actor;
    if (p === undefined || a === undefined) return;
    if (visible[p.y * level.grid.width + p.x] !== 1) return;
    mobs.push({ x: p.x, y: p.y, glyph: a.glyph });
  });
  // Mask the grid: seen tiles ship as-is, the rest as TILE_UNSEEN.
  const tiles: number[] = new Array(level.grid.tiles.length);
  for (const [i, raw] of level.grid.tiles.entries()) {
    tiles[i] = seen[i] === 1 ? raw : TILE_UNSEEN;
  }
  const stairs = level.downStairs;
  const stairsSeen =
    stairs !== null && seen[stairs[1] * level.grid.width + stairs[0]] === 1;
  return {
    type: "state",
    turn,
    gameOver,
    activeZone: state.activeZone,
    zones: Array.from(state.zones.keys()),
    player: { x: pos.x, y: pos.y, hp: { current: hp.current, max: hp.max } },
    mobs,
    level: {
      grid: {
        width: level.grid.width,
        height: level.grid.height,
        tiles,
      },
      downStairs: stairs !== null && stairsSeen ? toPair(stairs) : null,
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
        // Game over: drop inbound actions on the floor. The client already
        // has the terminal snapshot (the one that flipped `gameOver` to
        // true); re-emitting the same payload on every keystroke would be
        // noise. The state machine stays frozen until the connection
        // closes.
        if (state.gameOver) return;
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
