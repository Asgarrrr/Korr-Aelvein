// Perception filtering at the wire boundary (`toSnapshot`). The game-side
// mask lifecycle lives in `domain/game/tests/perception.test.ts`; here we
// pin what actually leaves the server: masked tiles, FOV-filtered mobs,
// gated stairs, and the exact `level` key set (no spawn/rooms leakage).

import { describe, expect, test } from "bun:test";
import { toSnapshot } from "../app";
import { spawn } from "../domain/ecs/index";
import {
  activeZoneStatus,
  type GameState,
  newGame,
} from "../domain/game/index";

const TILE_UNSEEN = 255;

function popcount(mask: Uint8Array): number {
  let n = 0;
  for (const v of mask) n += v;
  return n;
}

/** First floor cell adjacent (4-dir) to the player — always in FOV. */
function adjacentFloor(state: GameState): { x: number; y: number } {
  const zone = activeZoneStatus(state);
  const snap = toSnapshot(state);
  const { x, y } = snap.player;
  const candidates = [
    { x, y: y - 1 },
    { x: x + 1, y },
    { x, y: y + 1 },
    { x: x - 1, y },
  ];
  for (const c of candidates) {
    const raw = zone.level.grid.tiles[c.y * zone.level.grid.width + c.x];
    if (raw === 1) return c;
  }
  throw new Error("test: player has no adjacent floor cell");
}

/** First floor cell outside the current FOV. */
function hiddenFloor(state: GameState): { x: number; y: number } {
  const zone = activeZoneStatus(state);
  const { width, height, tiles } = zone.level.grid;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (tiles[i] === 1 && zone.visible[i] !== 1) return { x, y };
    }
  }
  throw new Error("test: no floor cell outside the FOV");
}

describe("toSnapshot — tile masking", () => {
  test("wire tiles are exactly {0, 1, 2, 255}", () => {
    const snap = toSnapshot(newGame(42, "rim"));
    for (const v of snap.level.grid.tiles) {
      expect([0, 1, 2, TILE_UNSEEN]).toContain(v);
    }
  });

  test("a corrupt raw byte on a seen cell ships as TILE_UNSEEN, not the byte (fail-closed)", () => {
    const state = newGame(42, "rim");
    const zone = activeZoneStatus(state);
    const idx = zone.seen.indexOf(1);
    if (idx < 0) throw new Error("test: no seen cell in a fresh game");
    // Uint8Array happily stores 7 — only the wire guard stands between a
    // corrupt byte and the client.
    zone.level.grid.tiles[idx] = 7;
    const snap = toSnapshot(state);
    expect(snap.level.grid.tiles[idx]).toBe(TILE_UNSEEN);
    // Widen for the negative assertion: 7 is (by design) not assignable
    // to the wire tile union, so `toContain` needs a plain number[] view.
    const wire: readonly number[] = snap.level.grid.tiles;
    expect(wire).not.toContain(7);
  });

  test("revealed wire tiles match popcount(seen), and only those", () => {
    const state = newGame(42, "rim");
    const zone = activeZoneStatus(state);
    const snap = toSnapshot(state);
    const revealed = snap.level.grid.tiles.filter(
      (v) => v !== TILE_UNSEEN,
    ).length;
    expect(revealed).toBe(popcount(zone.seen));
    for (const [i, v] of snap.level.grid.tiles.entries()) {
      if (zone.seen[i] === 1) {
        // Flipped operands: the wire value `v` is the literal union, the
        // raw byte is plain number — `toBe` is symmetric, types are not.
        expect(zone.level.grid.tiles[i]).toBe(v);
      } else {
        expect(v).toBe(TILE_UNSEEN);
      }
    }
  });
});

describe("toSnapshot — mob filtering", () => {
  test("a mob adjacent to the player is on the wire", () => {
    const state = newGame(42, "rim");
    const cell = adjacentFloor(state);
    spawn(activeZoneStatus(state).world, {
      position: { x: cell.x, y: cell.y },
      actor: { glyph: "x", name: "test-adjacent" },
      ai: { kind: "wanderer" },
      hp: { current: 1, max: 1 },
    });
    const snap = toSnapshot(state);
    expect(
      snap.mobs.some(
        (m) => m.x === cell.x && m.y === cell.y && m.glyph === "x",
      ),
    ).toBe(true);
  });

  test("a mob outside the FOV is absent from the wire", () => {
    const state = newGame(42, "rim");
    const cell = hiddenFloor(state);
    spawn(activeZoneStatus(state).world, {
      position: { x: cell.x, y: cell.y },
      actor: { glyph: "x", name: "test-hidden" },
      ai: { kind: "wanderer" },
      hp: { current: 1, max: 1 },
    });
    const snap = toSnapshot(state);
    expect(snap.mobs.some((m) => m.x === cell.x && m.y === cell.y)).toBe(false);
  });

  test("memory shows terrain, never entities: a mob on a seen-but-not-visible tile is absent", () => {
    // The discriminating case for the mob filter: `seen = 1, visible = 0`.
    // A plausible refactor — "mask mobs by `seen` like the tiles" — would
    // leak every mob standing in remembered terrain; this is the test
    // that catches it.
    const state = newGame(42, "rim");
    const zone = activeZoneStatus(state);
    const cell = hiddenFloor(state);
    const idx = cell.y * zone.level.grid.width + cell.x;
    zone.seen[idx] = 1;
    spawn(zone.world, {
      position: { x: cell.x, y: cell.y },
      actor: { glyph: "x", name: "test-remembered" },
      ai: { kind: "wanderer" },
      hp: { current: 1, max: 1 },
    });
    const snap = toSnapshot(state);
    // The tile itself ships (terrain memory)…
    expect(snap.level.grid.tiles[idx]).toBe(1);
    // …but the mob standing on it does not.
    expect(snap.mobs.some((m) => m.x === cell.x && m.y === cell.y)).toBe(false);
  });
});

describe("toSnapshot — stairs gating", () => {
  test("downStairs is null until seen, exposed once seen", () => {
    const state = newGame(42, "rim");
    const zone = activeZoneStatus(state);
    const stairs = zone.level.downStairs;
    if (stairs === null) throw new Error("test: rim level has no stairs");
    const idx = stairs[1] * zone.level.grid.width + stairs[0];
    // Force both sides of the gate by toggling the bits directly — no
    // dependence on where seed 42 puts the stairs relative to spawn.
    zone.seen[idx] = 0;
    zone.visible[idx] = 0;
    expect(toSnapshot(state).level.downStairs).toBeNull();
    // The gate is `seen` (map memory), NOT `visible` (current FOV) —
    // stairs must not vanish from the wire when the player looks away.
    zone.seen[idx] = 1;
    expect(toSnapshot(state).level.downStairs).toEqual([stairs[0], stairs[1]]);
  });
});

describe("toSnapshot — wire shape", () => {
  test("level carries exactly {grid, downStairs} — no spawn, no rooms", () => {
    const snap = toSnapshot(newGame(42, "rim"));
    expect(Object.keys(snap.level).sort()).toEqual(["downStairs", "grid"]);
  });
});
