import { describe, expect, test } from "bun:test";
import type { Level } from "../../../dungeon/index";
import { TILE_FLOOR } from "../../../dungeon/index";
import {
  despawn,
  emptyWorld,
  forQuery,
  getComponent,
  isLiveHandle,
  setComponent,
  spawn,
} from "../../../ecs/index";
import { emptyScheduler, schedule, size } from "../../../scheduler/index";
import {
  concretize,
  type GameState,
  type GlobalEvent,
  newGame,
  parkActiveZone,
  tick,
  type ZoneId,
  type ZoneStatus,
  zoneId,
} from "../../index";

type Pos = { x: number; y: number };

function dormantId(state: GameState): ZoneId {
  for (const [id, zone] of state.zones) {
    if (zone.kind === "dormant") return id;
  }
  throw new Error("test: no dormant zone");
}

function activeZone(state: GameState): ZoneStatus & { kind: "active" } {
  const z = state.zones.get(state.activeZone);
  if (z === undefined || z.kind !== "active") {
    throw new Error("test: state.activeZone is not active");
  }
  return z;
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

function playerPos(state: GameState): Pos {
  const p = getComponent(activeZone(state).world, state.playerId, "position");
  if (p === undefined) throw new Error("test: player has no position");
  return { x: p.x, y: p.y };
}

function countActorEventsFor(state: GameState, id: ZoneId): number {
  let n = 0;
  for (const ev of state.globalScheduler.heap) {
    const p = ev.payload;
    if (p.kind === "actor" && p.zone === id) n += 1;
  }
  return n;
}

function countScheduleEventsFor(state: GameState, id: ZoneId): number {
  let n = 0;
  for (const ev of state.globalScheduler.heap) {
    const p = ev.payload;
    if (p.kind === "schedule" && p.zone === id) n += 1;
  }
  return n;
}

// Blank perception masks for hand-built ZoneStatus literals. Perception
// itself is covered by perception.test.ts; here the fog just satisfies
// the required fields.
function makeFog(level: Level): { seen: Uint8Array; visible: Uint8Array } {
  const size = level.grid.width * level.grid.height;
  return { seen: new Uint8Array(size), visible: new Uint8Array(size) };
}

function playerActorEvent(
  state: GameState,
): { time: number; zone: ZoneId } | undefined {
  for (const ev of state.globalScheduler.heap) {
    const p = ev.payload;
    if (
      p.kind === "actor" &&
      p.entity.id === state.playerId.id &&
      p.entity.gen === state.playerId.gen
    ) {
      return { time: ev.time, zone: p.zone };
    }
  }
  return undefined;
}

describe("parkActiveZone", () => {
  test("throws when the target is already dormant", () => {
    const state = newGame(42, "rim");
    const dorm = dormantId(state);
    expect(() => parkActiveZone(state, dorm)).toThrow(/is dormant/);
  });

  test("despawns the player handle from the parked world", () => {
    const state = newGame(42, "rim");
    const zone = activeZone(state);
    parkActiveZone(state, state.activeZone);
    expect(isLiveHandle(zone.world, state.playerId)).toBe(false);
  });

  test("drops every actor event for the parked zone, leaves other zones' events intact", () => {
    const state = newGame(42, "rim");
    const donjon = state.activeZone;
    const village = dormantId(state);
    const donjonActorsBefore = countActorEventsFor(state, donjon);
    const villageScheduleBefore = countScheduleEventsFor(state, village);
    expect(donjonActorsBefore).toBeGreaterThan(0);
    expect(villageScheduleBefore).toBeGreaterThan(0);
    parkActiveZone(state, donjon);
    expect(countActorEventsFor(state, donjon)).toBe(0);
    expect(countScheduleEventsFor(state, village)).toBe(villageScheduleBefore);
  });

  test("flips zone to dormant with lastSimAt = state.time", () => {
    const state = newGame(42, "rim");
    parkActiveZone(state, state.activeZone);
    const z = state.zones.get(state.activeZone);
    expect(z?.kind).toBe("dormant");
    if (z?.kind === "dormant") {
      expect(z.lastSimAt).toBe(state.time);
    }
  });

  test("re-adds exactly one schedule event per Schedule-bearing entity in the parked zone", () => {
    // ENTER_ZONE the village, then ENTER_ZONE donjon again so the village
    // re-parks. After the re-park the village must have exactly as many
    // schedule events as it has Schedule-bearing entities — no leak
    // (would compound on every round-trip) and no drop (shopkeeper would
    // never cycle again).
    const seed = newGame(42, "rim");
    const village = dormantId(seed);
    const afterEnter = tick(seed, { type: "ENTER_ZONE", zone: village });
    const donjon = dormantId(afterEnter);
    const afterReturn = tick(afterEnter, { type: "ENTER_ZONE", zone: donjon });
    const villageNow = dormantZone(afterReturn, village);
    let scheduleEntities = 0;
    forQuery(villageNow.world, ["schedule"], () => {
      scheduleEntities += 1;
    });
    expect(countScheduleEventsFor(afterReturn, village)).toBe(scheduleEntities);
  });
});

describe("concretize", () => {
  test("throws when the target is already active", () => {
    const state = newGame(42, "rim");
    expect(() => concretize(state, state.activeZone)).toThrow(/is active/);
  });

  test("drops every schedule event for the concretized zone", () => {
    const state = newGame(42, "rim");
    const donjon = state.activeZone;
    const village = dormantId(state);
    // To concretize the village we must first park the donjon (only one
    // active zone at a time).
    parkActiveZone(state, donjon);
    expect(countScheduleEventsFor(state, village)).toBeGreaterThan(0);
    concretize(state, village);
    expect(countScheduleEventsFor(state, village)).toBe(0);
  });

  test("adds an actor event for each Ai-bearing entity in the concretized zone", () => {
    const state = newGame(42, "rim");
    const donjon = state.activeZone;
    parkActiveZone(state, donjon);
    expect(countActorEventsFor(state, donjon)).toBe(0);
    // Concretize donjon back (skip village) to isolate the assertion to
    // wanderer rehydration.
    concretize(state, donjon);
    // Donjon had 2 wanderers — confirm both get actor events.
    let aiCount = 0;
    forQuery(activeZone({ ...state, activeZone: donjon }).world, ["ai"], () => {
      aiCount += 1;
    });
    expect(countActorEventsFor(state, donjon)).toBe(aiCount);
  });

  test("flips zone to active", () => {
    const state = newGame(42, "rim");
    const donjon = state.activeZone;
    const village = dormantId(state);
    parkActiveZone(state, donjon);
    concretize(state, village);
    expect(state.zones.get(village)?.kind).toBe("active");
  });
});

describe("tick: ENTER_ZONE — refusal and validation", () => {
  test("refuses target === activeZone, returns same wrapper, no state change", () => {
    const state = newGame(42, "rim");
    const next = tick(state, { type: "ENTER_ZONE", zone: state.activeZone });
    expect(next).toBe(state);
    expect(next.turn).toBe(0);
  });

  test("refuses silently on an unknown zone id, returns same wrapper", () => {
    // Server controls the zone graph the client sees, so an off-list id
    // is hostile / racing client input — refuse like MOVE-into-wall rather
    // than throw and tear down the session.
    const state = newGame(42, "rim");
    const next = tick(state, { type: "ENTER_ZONE", zone: zoneId(999) });
    expect(next).toBe(state);
    expect(next.turn).toBe(0);
  });

  test("refuses a malformed zone number (NaN) like any other unknown id", () => {
    // `zoneId()` only tags the type — it does not validate. `bodySchema`'s
    // `t.Number()` admits NaN/floats, so the trust boundary relies on the
    // not-found refusal: `zones.get(NaN)` misses, the tick returns unchanged.
    const state = newGame(42, "rim");
    const next = tick(state, { type: "ENTER_ZONE", zone: zoneId(Number.NaN) });
    expect(next).toBe(state);
    expect(next.turn).toBe(0);
  });

  test("survives many unknown-zone messages without poisoning the session", () => {
    let s = newGame(42, "rim");
    for (let i = 0; i < 10; i++) {
      s = tick(s, { type: "ENTER_ZONE", zone: zoneId(999) });
    }
    // Session still answers normal actions afterwards.
    expect(() => tick(s, { type: "WAIT" })).not.toThrow();
  });
});

describe("tick: ENTER_ZONE — transition", () => {
  test("advances the turn, rotates activeZone, swaps playerId", () => {
    const state = newGame(42, "rim");
    const target = dormantId(state);
    const next = tick(state, { type: "ENTER_ZONE", zone: target });
    expect(next.turn).toBe(1);
    expect(next.activeZone).toBe(target);
    // playerId rotates: the new handle points into the new world, not the old.
    expect(next.playerId).not.toEqual(state.playerId);
    expect(isLiveHandle(activeZone(next).world, next.playerId)).toBe(true);
  });

  test("player lands at the destination's level.spawn", () => {
    const state = newGame(42, "rim");
    const target = dormantId(state);
    const next = tick(state, { type: "ENTER_ZONE", zone: target });
    const dest = activeZone(next);
    if (dest.level.spawn === null) {
      throw new Error("test: destination has no spawn (rim should set one)");
    }
    const [sx, sy] = dest.level.spawn;
    const p = playerPos(next);
    expect(p).toEqual({ x: sx, y: sy });
  });

  test("carries player hp across the transition", () => {
    const state = newGame(42, "rim");
    const oldWorld = activeZone(state).world;
    // Mutate the player's hp so it's distinguishable from the default 10/10.
    setComponent(oldWorld, state.playerId, "hp", { current: 4, max: 10 });
    const target = dormantId(state);
    const next = tick(state, { type: "ENTER_ZONE", zone: target });
    const hp = getComponent(activeZone(next).world, next.playerId, "hp");
    expect(hp).toEqual({ current: 4, max: 10 });
  });

  test("schedules the player's next actor event at popped + ACTION_COST on a fresh game", () => {
    const state = newGame(42, "rim");
    const target = dormantId(state);
    // Tick 0 with newGame at seed=42: the player's current actor event is
    // at time=0 (FIFO seq=0). pop advances scheduler.now to 0. New event
    // scheduled at 0 + ACTION_COST = 100.
    const next = tick(state, { type: "ENTER_ZONE", zone: target });
    const pev = playerActorEvent(next);
    expect(pev).toBeDefined();
    if (pev !== undefined) {
      expect(pev.zone).toBe(target);
      expect(pev.time).toBe(100);
    }
  });

  test("schedules the player's next event at popped + ACTION_COST when ENTER_ZONE follows a WAIT", () => {
    // Regression: `playerNextTime` was originally computed *before* the
    // player's pop, which is wrong for any tick where the previous tick's
    // drain stopped at a `scheduler.now` strictly less than the player's
    // current event time. WAIT → ENTER_ZONE is the minimal repro: after
    // WAIT, scheduler.now = 0 (drain ends on the wanderers at time=0),
    // but the player's current event is at time=100. Pre-pop arithmetic
    // would give 0+100=100 (same time as the just-popped event, zero turn
    // cost); post-pop arithmetic gives 100+100=200 (one ACTION_COST later,
    // matching MOVE/WAIT semantics).
    let s = newGame(42, "rim");
    s = tick(s, { type: "WAIT" });
    const target = dormantId(s);
    s = tick(s, { type: "ENTER_ZONE", zone: target });
    const pev = playerActorEvent(s);
    expect(pev).toBeDefined();
    if (pev !== undefined) {
      expect(pev.time).toBe(200);
    }
  });
});

describe("tick: ENTER_ZONE — heap invariants after transition", () => {
  test("no actor events remain for the now-dormant origin zone", () => {
    const state = newGame(42, "rim");
    const donjon = state.activeZone;
    const village = dormantId(state);
    const next = tick(state, { type: "ENTER_ZONE", zone: village });
    expect(countActorEventsFor(next, donjon)).toBe(0);
  });

  test("no schedule events remain for the now-active destination zone", () => {
    const state = newGame(42, "rim");
    const village = dormantId(state);
    const next = tick(state, { type: "ENTER_ZONE", zone: village });
    expect(countScheduleEventsFor(next, village)).toBe(0);
  });
});

describe("tick: ENTER_ZONE — round-trip determinism", () => {
  test("same seed + same action sequence produces the same wrapper-level state", () => {
    function run(): {
      turn: number;
      time: number;
      activeZone: ZoneId;
      pos: Pos;
    } {
      let s = newGame(7, "rim");
      const village = dormantId(s);
      s = tick(s, { type: "ENTER_ZONE", zone: village });
      s = tick(s, { type: "WAIT" });
      const donjon = dormantId(s);
      s = tick(s, { type: "ENTER_ZONE", zone: donjon });
      return {
        turn: s.turn,
        time: s.time,
        activeZone: s.activeZone,
        pos: playerPos(s),
      };
    }
    expect(run()).toEqual(run());
  });
});

describe("tick: ENTER_ZONE — frozen NPCs resume on reactivation", () => {
  test("donjon wanderers stay at their last positions while donjon is dormant", () => {
    const state = newGame(42, "rim");
    const village = dormantId(state);
    // Capture wanderer positions before leaving. Sort to compare as a set
    // — iteration order over the position column can change across a
    // player despawn/respawn cycle.
    function wandererPositions(
      world: import("../../../ecs/index").World,
    ): Pos[] {
      const out: Pos[] = [];
      forQuery(world, ["position", "ai"], (_handle, view) => {
        const p = view.position;
        if (p !== undefined) out.push({ x: p.x, y: p.y });
      });
      out.sort((a, b) => (a.x === b.x ? a.y - b.y : a.x - b.x));
      return out;
    }
    const before = wandererPositions(activeZone(state).world);
    // Enter the village; wait many turns; come back is unnecessary for this
    // assertion — the donjon stays dormant the whole time.
    let s = tick(state, { type: "ENTER_ZONE", zone: village });
    for (let i = 0; i < 50; i++) {
      s = tick(s, { type: "WAIT" });
    }
    const donjonId = dormantId(s);
    const dz = dormantZone(s, donjonId);
    expect(wandererPositions(dz.world)).toEqual(before);
  });

  test("shopkeeper position is unchanged across active-village → dormant-village transition", () => {
    // The shopkeeper has no Ai, so they become inert when their zone is
    // active. Their position must not move during the active phase.
    const state = newGame(42, "rim");
    const village = dormantId(state);
    const vz0 = dormantZone(state, village);
    // Find shopkeeper handle + initial position.
    let shopHandle: { id: number; gen: number } | undefined;
    forQuery(vz0.world, ["schedule"], (h) => {
      if (shopHandle === undefined) shopHandle = { id: h.id, gen: h.gen };
    });
    if (shopHandle === undefined) throw new Error("test: no shopkeeper");
    const before = getComponent(vz0.world, shopHandle, "position");
    if (before === undefined) throw new Error("test: shopkeeper has no pos");
    // Enter village; wait a long time; leave.
    let s = tick(state, { type: "ENTER_ZONE", zone: village });
    for (let i = 0; i < 100; i++) {
      s = tick(s, { type: "WAIT" });
    }
    // Shopkeeper is in the now-active world — must not have moved (no Ai).
    const midActiveWorld = activeZone(s).world;
    const mid = getComponent(midActiveWorld, shopHandle, "position");
    expect(mid).toEqual(before);
    const donjon = dormantId(s);
    s = tick(s, { type: "ENTER_ZONE", zone: donjon });
    const villageNow = dormantZone(s, village);
    const after = getComponent(villageNow.world, shopHandle, "position");
    expect(after).toEqual(before);
  });
});

describe("concretize — same-time catchup", () => {
  function makeAllFloorLevel(w: number, h: number, spawnCell: Pos): Level {
    const tiles = new Uint8Array(w * h);
    for (let i = 0; i < tiles.length; i++) tiles[i] = TILE_FLOOR;
    return {
      grid: { width: w, height: h, tiles },
      rooms: [],
      spawn: [spawnCell.x, spawnCell.y],
      downStairs: null,
    };
  }

  test("catchupDormant applies same-time schedule events before flipping the zone", () => {
    // The drain stops on the player heap top; same-time-but-later-seq
    // schedule events for the soon-to-be-active zone can still be in the
    // heap when concretize runs. Catchup pops + applies them so the zone
    // is up to date before its discriminator flips.
    const DUMMY = zoneId(0);
    const TARGET = zoneId(1);
    const level = makeAllFloorLevel(3, 3, { x: 0, y: 0 });

    const dummyWorld = emptyWorld();
    const playerId = spawn(dummyWorld, {
      position: { x: 0, y: 0 },
      actor: { glyph: "@", name: "you" },
      hp: { current: 10, max: 10 },
    });

    const targetWorld = emptyWorld();
    const waypoints: ReadonlyArray<readonly [number, number]> = [
      [1, 1],
      [2, 2],
    ];
    const npcId = spawn(targetWorld, {
      position: { x: 1, y: 1 },
      actor: { glyph: "v", name: "npc" },
      schedule: { waypoints, nextIndex: 1, period: 100 },
    });

    const scheduler = emptyScheduler<GlobalEvent>();
    // Pre-set scheduler.now via a no-op pop dance is impossible without a
    // payload; instead just schedule directly at time = 100 from now=0, and
    // set state.time = 100 explicitly so `catchupDormant`'s `time <=
    // state.time` filter matches.
    schedule(scheduler, 100, {
      kind: "schedule",
      zone: TARGET,
      entity: npcId,
    });

    const state: GameState = {
      zones: new Map<ZoneId, ZoneStatus>([
        [
          DUMMY,
          { kind: "active", world: dummyWorld, level, ...makeFog(level) },
        ],
        [
          TARGET,
          {
            kind: "dormant",
            world: targetWorld,
            level,
            ...makeFog(level),
            lastSimAt: 0,
          },
        ],
      ]),
      activeZone: DUMMY,
      playerId,
      globalScheduler: scheduler,
      rngState: [1, 2, 3, 4],
      time: 100,
      turn: 0,
      gameOver: false,
    };

    parkActiveZone(state, DUMMY);
    concretize(state, TARGET);

    const targetNow = state.zones.get(TARGET);
    if (targetNow === undefined || targetNow.kind !== "active") {
      throw new Error("test: TARGET should be active after concretize");
    }
    const pos = getComponent(targetNow.world, npcId, "position");
    expect(pos).toEqual({ x: 2, y: 2 });
  });

  test("concretize drains schedule events with stale entities without crashing or surviving on the heap", () => {
    // applyAbstract guards on `isLiveHandle` and returns undefined for
    // despawned entities. The catchup must still drain the heap entry
    // (otherwise it would throw in `drainNonPlayer` once the zone is
    // active). The companion invariant — "lastSimAt does not advance on a
    // refusal" — is contract-only (the field is invisible post-flip), but
    // the drain side-effect is observable: the stale event must not
    // survive on the heap.
    const DUMMY = zoneId(0);
    const TARGET = zoneId(1);
    const level = makeAllFloorLevel(3, 3, { x: 0, y: 0 });

    const dummyWorld = emptyWorld();
    const playerId = spawn(dummyWorld, {
      position: { x: 0, y: 0 },
      actor: { glyph: "@", name: "you" },
      hp: { current: 10, max: 10 },
    });

    const targetWorld = emptyWorld();
    const waypoints: ReadonlyArray<readonly [number, number]> = [
      [1, 1],
      [2, 2],
    ];
    const npcId = spawn(targetWorld, {
      position: { x: 1, y: 1 },
      actor: { glyph: "v", name: "npc" },
      schedule: { waypoints, nextIndex: 1, period: 100 },
    });
    // Entity exists on the world but is despawned before concretize runs —
    // its heap entry survives (lazy-skip pattern), but applyAbstract sees a
    // stale handle and bails.
    despawn(targetWorld, npcId);

    const scheduler = emptyScheduler<GlobalEvent>();
    schedule(scheduler, 100, {
      kind: "schedule",
      zone: TARGET,
      entity: npcId,
    });

    const initialLastSimAt = 50;
    const state: GameState = {
      zones: new Map<ZoneId, ZoneStatus>([
        [
          DUMMY,
          { kind: "active", world: dummyWorld, level, ...makeFog(level) },
        ],
        [
          TARGET,
          {
            kind: "dormant",
            world: targetWorld,
            level,
            ...makeFog(level),
            lastSimAt: initialLastSimAt,
          },
        ],
      ]),
      activeZone: DUMMY,
      playerId,
      globalScheduler: scheduler,
      rngState: [1, 2, 3, 4],
      time: 100,
      turn: 0,
      gameOver: false,
    };

    parkActiveZone(state, DUMMY);
    // After parkActiveZone the TARGET zone is still dormant — read it back
    // so we can inspect its post-concretize state.
    concretize(state, TARGET);

    // Zone is now active. Before the contract fix it would have advanced
    // lastSimAt to 100 even though the event was a no-op; that snapshot is
    // gone once the zone flips, so we check the pre-flip state via the
    // catchup's documented invariant: the event should still have been
    // drained from the heap (no `schedule` event survives concretize), and
    // no position mutation occurred on the despawned entity.
    expect(size(state.globalScheduler)).toBeLessThanOrEqual(1);
    // Heap survivor (if any) is for DUMMY, never a stale TARGET schedule.
    for (const ev of state.globalScheduler.heap) {
      const p = ev.payload;
      expect(p.kind === "schedule" && p.zone === TARGET).toBe(false);
    }
  });

  test("concretize skips schedule events with time <= lastSimAt (lower-bound contract)", () => {
    // Pinned defensive contract: the catchup window is `(lastSimAt,
    // state.time]`. Events at time <= lastSimAt have already been applied
    // by an earlier drain pass and must not be re-applied. Today's drain
    // loop pops them before they accumulate, but the lower bound keeps
    // concretize correct under any future drain refactor.
    const DUMMY = zoneId(0);
    const TARGET = zoneId(1);
    const level = makeAllFloorLevel(3, 3, { x: 0, y: 0 });

    const dummyWorld = emptyWorld();
    const playerId = spawn(dummyWorld, {
      position: { x: 0, y: 0 },
      actor: { glyph: "@", name: "you" },
      hp: { current: 10, max: 10 },
    });

    const targetWorld = emptyWorld();
    const waypoints: ReadonlyArray<readonly [number, number]> = [
      [1, 1],
      [2, 2],
    ];
    // NPC starts at (1,1), nextIndex points at the (2,2) waypoint. If
    // applyAbstract fires, it moves the NPC to (2,2). If concretize
    // honours the lower bound, the position stays at (1,1).
    const npcId = spawn(targetWorld, {
      position: { x: 1, y: 1 },
      actor: { glyph: "v", name: "npc" },
      schedule: { waypoints, nextIndex: 1, period: 100 },
    });

    const scheduler = emptyScheduler<GlobalEvent>();
    // Event scheduled at time = 30, but lastSimAt = 50 — meaning this
    // event was already applied in a previous drain pass (constructed
    // artificially here; the running game would have popped it).
    schedule(scheduler, 30, {
      kind: "schedule",
      zone: TARGET,
      entity: npcId,
    });

    const state: GameState = {
      zones: new Map<ZoneId, ZoneStatus>([
        [
          DUMMY,
          { kind: "active", world: dummyWorld, level, ...makeFog(level) },
        ],
        [
          TARGET,
          {
            kind: "dormant",
            world: targetWorld,
            level,
            ...makeFog(level),
            lastSimAt: 50,
          },
        ],
      ]),
      activeZone: DUMMY,
      playerId,
      globalScheduler: scheduler,
      rngState: [1, 2, 3, 4],
      time: 100,
      turn: 0,
      gameOver: false,
    };

    parkActiveZone(state, DUMMY);
    concretize(state, TARGET);

    const targetNow = state.zones.get(TARGET);
    if (targetNow === undefined || targetNow.kind !== "active") {
      throw new Error("test: TARGET should be active after concretize");
    }
    // Position unchanged → applyAbstract was never called for the event
    // at time=30 (it sat below lastSimAt=50).
    const pos = getComponent(targetNow.world, npcId, "position");
    expect(pos).toEqual({ x: 1, y: 1 });
  });

  test("enterZone leaves the origin zone active when the target has no free spawn cell", () => {
    // 3×3 grid, only the center is floor; an NPC stands on it. Both
    // `level.spawn` (the center) and the row-major fallback fail —
    // `findPlayerSpawnCell` throws. Because the throw fires *before* the
    // park/concretize mutations, the GameState handed back to the WS
    // handler is unchanged: origin zone still active, target still
    // dormant.
    const DUMMY = zoneId(0);
    const TARGET = zoneId(1);

    const tiles = new Uint8Array(9);
    tiles[4] = TILE_FLOOR; // center
    const targetLevel: Level = {
      grid: { width: 3, height: 3, tiles },
      rooms: [],
      spawn: [1, 1],
      downStairs: null,
    };
    const sourceLevel = makeAllFloorLevel(3, 3, { x: 0, y: 0 });

    const sourceWorld = emptyWorld();
    const playerId = spawn(sourceWorld, {
      position: { x: 0, y: 0 },
      actor: { glyph: "@", name: "you" },
      hp: { current: 10, max: 10 },
    });
    const targetWorld = emptyWorld();
    spawn(targetWorld, {
      position: { x: 1, y: 1 },
      actor: { glyph: "v", name: "obstacle" },
    });

    const scheduler = emptyScheduler<GlobalEvent>();
    schedule(scheduler, 0, {
      kind: "actor",
      zone: DUMMY,
      entity: playerId,
    });

    const state: GameState = {
      zones: new Map<ZoneId, ZoneStatus>([
        [
          DUMMY,
          {
            kind: "active",
            world: sourceWorld,
            level: sourceLevel,
            ...makeFog(sourceLevel),
          },
        ],
        [
          TARGET,
          {
            kind: "dormant",
            world: targetWorld,
            level: targetLevel,
            ...makeFog(targetLevel),
            lastSimAt: 0,
          },
        ],
      ]),
      activeZone: DUMMY,
      playerId,
      globalScheduler: scheduler,
      rngState: [1, 2, 3, 4],
      time: 0,
      turn: 0,
      gameOver: false,
    };

    expect(() => tick(state, { type: "ENTER_ZONE", zone: TARGET })).toThrow(
      /no free floor cells/,
    );
    // Origin untouched.
    expect(state.zones.get(DUMMY)?.kind).toBe("active");
    expect(state.zones.get(TARGET)?.kind).toBe("dormant");
    expect(state.activeZone).toBe(DUMMY);
  });
});

describe("tick: ENTER_ZONE — drain invariant restored", () => {
  test("after ENTER_ZONE, the next tick's player-on-top precondition holds", () => {
    // If the post-tick drain didn't restore the player-on-top invariant in
    // the new zone, the *next* tick would throw on its peek-then-isPlayerTurn
    // check. So a successful follow-up MOVE/WAIT is the assertion.
    const state = newGame(42, "rim");
    const village = dormantId(state);
    const afterEnter = tick(state, { type: "ENTER_ZONE", zone: village });
    expect(() => tick(afterEnter, { type: "WAIT" })).not.toThrow();
  });

  test("scheduler size remains bounded across many transitions", () => {
    // Heap pollution check: each round-trip drops and re-adds the same
    // categories of events. Size must not grow unboundedly.
    let s = newGame(42, "rim");
    const village = dormantId(s);
    s = tick(s, { type: "ENTER_ZONE", zone: village });
    const donjon = dormantId(s);
    s = tick(s, { type: "ENTER_ZONE", zone: donjon });
    const refSize = size(s.globalScheduler);
    for (let i = 0; i < 10; i++) {
      const v = dormantId(s);
      s = tick(s, { type: "ENTER_ZONE", zone: v });
      const d = dormantId(s);
      s = tick(s, { type: "ENTER_ZONE", zone: d });
    }
    expect(size(s.globalScheduler)).toBe(refSize);
  });
});
