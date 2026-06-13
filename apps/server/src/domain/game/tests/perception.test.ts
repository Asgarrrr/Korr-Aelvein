// Integration tests for zone perception memory: newGame initialisation,
// accumulation on accepted MOVEs, byte-level inertness on refusals and
// WAIT, and survival of `seen` across zone transitions. The FOV geometry
// itself is covered by `domain/perception/tests`; here we pin the
// *lifecycle* of the masks.

import { describe, expect, test } from "bun:test";
import type { Level } from "../../dungeon/index";
import { TILE_FLOOR } from "../../dungeon/index";
import { emptyWorld, getComponent, spawn } from "../../ecs/index";
import { emptyScheduler, schedule } from "../../scheduler/index";
import {
  activeZoneStatus,
  type GameState,
  type GlobalEvent,
  newGame,
  tick,
  type ZoneId,
  type ZoneStatus,
  zoneId,
} from "../index";

const DONJON_ZONE = zoneId(0);

function popcount(mask: Uint8Array): number {
  let n = 0;
  for (const v of mask) n += v;
  return n;
}

function dormantId(state: GameState): ZoneId {
  for (const [id, zone] of state.zones) {
    if (zone.kind === "dormant") return id;
  }
  throw new Error("test: no dormant zone");
}

function dormantZone(
  state: GameState,
  id: ZoneId,
): ZoneStatus & { kind: "dormant" } {
  const z = state.zones.get(id);
  if (z === undefined || z.kind !== "dormant") {
    throw new Error(`test: zone ${id} is not dormant`);
  }
  return z;
}

// 5x5 grid: wall border, 3x3 floor interior.
function makeBoxLevel(): Level {
  const W = 5;
  const H = 5;
  const tiles = new Uint8Array(W * H);
  for (let y = 1; y < 4; y++) {
    for (let x = 1; x < 4; x++) {
      tiles[y * W + x] = TILE_FLOOR;
    }
  }
  return {
    grid: { width: W, height: H, tiles },
    rooms: [],
    spawn: null,
    downStairs: null,
  };
}

// Hand-built single-zone state with EMPTY fog — the masks only fill via
// tick's updatePerception path, which is exactly what these tests pin.
function makeState(level: Level, x: number, y: number): GameState {
  const world = emptyWorld();
  const playerId = spawn(world, {
    position: { x, y },
    actor: { glyph: "@", name: "you" },
    hp: { current: 10, max: 10 },
  });
  const globalScheduler = emptyScheduler<GlobalEvent>();
  schedule(globalScheduler, 0, {
    kind: "actor",
    zone: DONJON_ZONE,
    entity: playerId,
  });
  const size = level.grid.width * level.grid.height;
  const zones = new Map<ZoneId, ZoneStatus>();
  zones.set(DONJON_ZONE, {
    kind: "active",
    world,
    level,
    seen: new Uint8Array(size),
    visible: new Uint8Array(size),
  });
  return {
    zones,
    activeZone: DONJON_ZONE,
    playerId,
    globalScheduler,
    rngState: [1, 2, 3, 4],
    time: 0,
    turn: 0,
    gameOver: false,
  };
}

describe("newGame — perception initialised before the first tick", () => {
  test("donjon: masks sized to the grid, FOV computed at spawn", () => {
    const state = newGame(42, "rim");
    const zone = activeZoneStatus(state);
    const size = zone.level.grid.width * zone.level.grid.height;
    expect(zone.seen.length).toBe(size);
    expect(zone.visible.length).toBe(size);
    expect(popcount(zone.visible)).toBeGreaterThan(0);
    // First FOV: nothing seen beyond the initial visible set.
    expect(Array.from(zone.seen)).toEqual(Array.from(zone.visible));
    const pos = getComponent(zone.world, state.playerId, "position");
    if (pos === undefined) throw new Error("test: player has no position");
    expect(zone.seen[pos.y * zone.level.grid.width + pos.x]).toBe(1);
  });

  test("village: masks allocated, fully dark (never perceived)", () => {
    const state = newGame(42, "rim");
    const village = dormantZone(state, dormantId(state));
    const size = village.level.grid.width * village.level.grid.height;
    expect(village.seen.length).toBe(size);
    expect(village.visible.length).toBe(size);
    expect(popcount(village.seen)).toBe(0);
    expect(popcount(village.visible)).toBe(0);
  });
});

describe("tick MOVE — accepted moves accumulate seen", () => {
  test("popcount(seen) is monotone non-decreasing over a walk", () => {
    let state = newGame(42, "rim");
    let lastSeen = popcount(activeZoneStatus(state).seen);
    expect(lastSeen).toBeGreaterThan(0);
    const dirs: ReadonlyArray<"n" | "e" | "s" | "w"> = [
      "n",
      "n",
      "e",
      "e",
      "e",
      "s",
      "w",
      "n",
      "e",
      "e",
    ];
    for (const dir of dirs) {
      state = tick(state, { type: "MOVE", dir });
      const zone = activeZoneStatus(state);
      const seenNow = popcount(zone.seen);
      expect(seenNow).toBeGreaterThanOrEqual(lastSeen);
      lastSeen = seenNow;
      // `seen` is always a superset of `visible`.
      for (const [i, v] of zone.visible.entries()) {
        if (v === 1) expect(zone.seen[i]).toBe(1);
      }
    }
  });

  test("an accepted step updates visible to the new position's FOV", () => {
    const state = makeState(makeBoxLevel(), 2, 2);
    expect(popcount(activeZoneStatus(state).visible)).toBe(0);
    const next = tick(state, { type: "MOVE", dir: "n" });
    const zone = activeZoneStatus(next);
    // 3×3 interior + full wall ring all within radius from (2,1).
    expect(popcount(zone.visible)).toBeGreaterThan(0);
    expect(zone.visible[1 * 5 + 2]).toBe(1);
  });

  test("an accepted step mutates the masks in place — references stable", () => {
    // Pins the "mutate in place, wrapper rotates" convention: `visible`
    // and `seen` keep the same identity for the zone's lifetime even when
    // their bytes change (same convention as World / Scheduler).
    const state = makeState(makeBoxLevel(), 2, 2);
    const zoneBefore = activeZoneStatus(state);
    const seenRef = zoneBefore.seen;
    const visibleRef = zoneBefore.visible;
    const visibleBytes = Array.from(zoneBefore.visible);
    const next = tick(state, { type: "MOVE", dir: "n" });
    const zoneAfter = activeZoneStatus(next);
    expect(zoneAfter.visible).toBe(visibleRef);
    expect(zoneAfter.seen).toBe(seenRef);
    // Bytes did change — identity stability is not byte stagnation.
    expect(Array.from(zoneAfter.visible)).not.toEqual(visibleBytes);
  });
});

describe("tick MOVE refused / WAIT — masks byte-identical", () => {
  test("a refused MOVE leaves the same references AND the same bytes", () => {
    // First an accepted step to (2,1) so the masks hold a real FOV —
    // all-zero masks would make the byte comparison vacuous.
    let state = makeState(makeBoxLevel(), 2, 2);
    state = tick(state, { type: "MOVE", dir: "n" });
    const zone = activeZoneStatus(state);
    const seenRef = zone.seen;
    const visibleRef = zone.visible;
    const seenBytes = Array.from(zone.seen);
    const visibleBytes = Array.from(zone.visible);
    expect(popcount(zone.seen)).toBeGreaterThan(0);
    // (2,1) faces the wall at (2,0): refusal.
    const next = tick(state, { type: "MOVE", dir: "n" });
    expect(next).toBe(state);
    const zoneAfter = activeZoneStatus(next);
    // Same references is not enough — mutable arrays could have been
    // written in place. Compare bytes too.
    expect(zoneAfter.seen).toBe(seenRef);
    expect(zoneAfter.visible).toBe(visibleRef);
    expect(Array.from(zoneAfter.seen)).toEqual(seenBytes);
    expect(Array.from(zoneAfter.visible)).toEqual(visibleBytes);
  });

  test("WAIT is perception-inert even while mobs move", () => {
    const state = newGame(42, "rim");
    const zone = activeZoneStatus(state);
    const seenRef = zone.seen;
    const visibleRef = zone.visible;
    const seenBytes = Array.from(zone.seen);
    const visibleBytes = Array.from(zone.visible);
    const next = tick(state, { type: "WAIT" });
    const zoneAfter = activeZoneStatus(next);
    expect(zoneAfter.seen).toBe(seenRef);
    expect(zoneAfter.visible).toBe(visibleRef);
    expect(Array.from(zoneAfter.seen)).toEqual(seenBytes);
    expect(Array.from(zoneAfter.visible)).toEqual(visibleBytes);
  });
});

describe("ENTER_ZONE — perception across transitions", () => {
  test("arrival initialises the target zone's FOV before the snapshot", () => {
    const state = newGame(42, "rim");
    const village = dormantId(state);
    const next = tick(state, { type: "ENTER_ZONE", zone: village });
    const zone = activeZoneStatus(next);
    expect(popcount(zone.visible)).toBeGreaterThan(0);
    expect(popcount(zone.seen)).toBe(popcount(zone.visible));
    const pos = getComponent(zone.world, next.playerId, "position");
    if (pos === undefined) throw new Error("test: player has no position");
    expect(zone.seen[pos.y * zone.level.grid.width + pos.x]).toBe(1);
  });

  test("the parked zone's seen survives park + concretize by reference", () => {
    const state = newGame(42, "rim");
    const donjonBefore = activeZoneStatus(state);
    const seenRef = donjonBefore.seen;
    const seenBytes = Array.from(donjonBefore.seen);
    const village = dormantId(state);
    // Park the donjon by entering the village.
    let s = tick(state, { type: "ENTER_ZONE", zone: village });
    const donjonDormant = dormantZone(s, DONJON_ZONE);
    expect(donjonDormant.seen).toBe(seenRef);
    expect(Array.from(donjonDormant.seen)).toEqual(seenBytes);
    // Concretize it back by returning.
    s = tick(s, { type: "ENTER_ZONE", zone: DONJON_ZONE });
    const donjonAgain = activeZoneStatus(s);
    expect(donjonAgain.seen).toBe(seenRef);
    // Map memory restored: everything seen before the round-trip is
    // still seen (arrival FOV can only have added bits).
    for (const [i, v] of seenBytes.entries()) {
      if (v === 1) expect(donjonAgain.seen[i]).toBe(1);
    }
  });
});
