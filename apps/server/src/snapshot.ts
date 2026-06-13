/**
 * The outbound wire projection: `GameState → Snapshot`. Split from `app.ts`
 * (which owns transport — the Elysia routes and the inbound `bodySchema`)
 * because the response schema, its derived TS type, and the perception
 * filtering that produces it form one cohesive contract, already tested and
 * benched in isolation (`tests/snapshot.test.ts`, `bench/snapshot.bench.ts`).
 *
 * Server-authoritative invariant: this is the ONLY place game state is
 * narrowed for the client. Anything not written here never reaches the wire
 * — mobs outside the current FOV, tiles never seen, the spawn point, room
 * rects. Keep the leak surface here and nowhere else.
 */

import { t } from "elysia";
import { isTile } from "./domain/dungeon/index";
import { forQuery, getComponent } from "./domain/ecs/index";
import { activeZoneStatus, type GameState } from "./domain/game/index";

const TCoords = t.Tuple([t.Number(), t.Number()]);

/**
 * Wire sentinel for a tile the player has never seen. Lives here, not in
 * the dungeon domain — `Tile` stays `0 | 1 | 2`; 255 exists only on the
 * wire. The client renders it as blank space (`apps/client/src/render.ts`),
 * type-binding its own copy to `WireTile` so this value can't drift unseen.
 * Exported so the snapshot tests assert against the real sentinel.
 */
export const TILE_UNSEEN = 255;

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
      tiles: t.Array(
        t.Union([
          t.Literal(0),
          t.Literal(1),
          t.Literal(2),
          t.Literal(TILE_UNSEEN),
        ]),
      ),
    }),
    downStairs: t.Union([t.Null(), TCoords]),
  }),
});

// Single source of truth: the wire-format TS type is derived from the
// TypeBox response schema (`typeof schema.static`). Schema and TS type
// can no longer drift.
export type Snapshot = typeof responseSchema.static;

// Derived from the schema, not redeclared — the schema's literal union is
// the single source of truth for what a tile may look like on the wire.
// Exported (via the `server` barrel) so the client renderer type-binds its
// fog sentinel to it instead of duplicating the literal blind.
export type WireTile = Snapshot["level"]["grid"]["tiles"][number];

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
    if (visible[p.y * level.grid.width + p.x] !== 1) return;
    mobs.push({ x: p.x, y: p.y, glyph: a.glyph });
  });
  // Mask the grid: seen tiles ship as-is, the rest as TILE_UNSEEN. Fail
  // closed: a raw byte outside {0, 1, 2} (corruption) also ships as fog,
  // matching the perception module's `opaqueAt` stance on unknown tiles.
  //
  // Accepted trade-off: a full O(W·H) rebuild + alloc every tick, even on a
  // refused move that returns an identical grid (80×30 = 2400 cells; cost
  // measured negligible, and permessage-deflate collapses the fog runs
  // ~97%). The escape hatch when a bench says otherwise is the diff push
  // the architecture already contemplates — ship `seen`-delta tiles, not a
  // fresh full mask. Not worth the bookkeeping until a profile demands it.
  const tiles: WireTile[] = new Array(level.grid.tiles.length);
  for (const [i, raw] of level.grid.tiles.entries()) {
    tiles[i] = seen[i] === 1 && isTile(raw) ? raw : TILE_UNSEEN;
  }
  // downStairs ships only once its tile has been seen, null otherwise. The
  // null-guard here is also what narrows `stairs` for the coordinate reads,
  // so the result is computed once rather than re-tested at the return site.
  const stairs = level.downStairs;
  let downStairs: Snapshot["level"]["downStairs"] = null;
  if (stairs !== null && seen[stairs[1] * level.grid.width + stairs[0]] === 1) {
    downStairs = [stairs[0], stairs[1]];
  }
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
      downStairs,
    },
  };
}
