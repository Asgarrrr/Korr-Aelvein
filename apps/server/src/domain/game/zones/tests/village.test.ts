import { describe, expect, test } from "bun:test";
import {
  despawn,
  forQuery,
  getComponent,
  removeComponent,
  type World,
} from "../../../ecs/index";
import { size } from "../../../scheduler/index";
import {
  type GameState,
  newGame,
  tick,
  type ZoneId,
  type ZoneStatus,
} from "../../index";

type Pos = { x: number; y: number };

function dormantZone(state: GameState): {
  id: ZoneId;
  zone: ZoneStatus & { kind: "dormant" };
} {
  for (const [id, zone] of state.zones) {
    if (zone.kind === "dormant") return { id, zone };
  }
  throw new Error("test: no dormant zone found in state");
}

function villagerHandle(world: World): { id: number; gen: number } {
  let found: { id: number; gen: number } | undefined;
  forQuery(world, ["schedule"], (handle) => {
    if (found === undefined) found = { id: handle.id, gen: handle.gen };
  });
  if (found === undefined) {
    throw new Error("test: no villager (schedule-bearing entity) found");
  }
  return found;
}

function villagerPos(state: GameState): Pos {
  const { zone } = dormantZone(state);
  const handle = villagerHandle(zone.world);
  const p = getComponent(zone.world, handle, "position");
  if (p === undefined) {
    throw new Error("test: villager has no position");
  }
  return { x: p.x, y: p.y };
}

// Run `n` consecutive WAITs from a starting state.
function waitN(state: GameState, n: number): GameState {
  let s = state;
  for (let i = 0; i < n; i++) s = tick(s, { type: "WAIT" });
  return s;
}

describe("newGame: village zone setup", () => {
  test("a dormant village zone exists alongside the active donjon", () => {
    const state = newGame(42, "rim");
    const { zone } = dormantZone(state);
    expect(zone.kind).toBe("dormant");
    expect(zone.lastSimAt).toBe(0);
    expect(zone.level.grid.width).toBeGreaterThan(0);
  });

  test("the village holds one villager with home/counter waypoints", () => {
    const state = newGame(42, "rim");
    const { zone } = dormantZone(state);
    const handle = villagerHandle(zone.world);
    const sched = getComponent(zone.world, handle, "schedule");
    expect(sched).toBeDefined();
    if (sched === undefined) return;
    expect(sched.waypoints.length).toBe(2);
    // Villager spawns at waypoints[0] (home); `nextIndex = 1` so the very
    // first schedule event moves them to waypoints[1] (the counter).
    expect(sched.nextIndex).toBe(1);
    expect(sched.period).toBeGreaterThan(0);
    const startPos = villagerPos(state);
    const home = sched.waypoints[0];
    if (home === undefined) {
      throw new Error("test: waypoints[0] missing");
    }
    expect(startPos.x).toBe(home[0]);
    expect(startPos.y).toBe(home[1]);
  });
});

describe("tick: abstract resolver advances the village schedule", () => {
  test("villager toggles home → counter → home over two full periods", () => {
    const state = newGame(42, "rim");
    const { zone } = dormantZone(state);
    const handle = villagerHandle(zone.world);
    const sched0 = getComponent(zone.world, handle, "schedule");
    if (sched0 === undefined) {
      throw new Error("test: villager has no schedule");
    }
    const home = sched0.waypoints[0];
    const counter = sched0.waypoints[1];
    if (home === undefined || counter === undefined) {
      throw new Error("test: villager schedule missing waypoints");
    }
    const period = sched0.period;
    // One "tick" advances scheduler-time by 100 (one ACTION_COST). Number
    // of WAITs needed to cross a full schedule period is period/100.
    const turnsPerPeriod = period / 100;
    // First period: villager moves to counter.
    const afterOne = waitN(state, turnsPerPeriod);
    expect(villagerPos(afterOne)).toEqual({ x: counter[0], y: counter[1] });
    // Second period: villager moves back home.
    const afterTwo = waitN(afterOne, turnsPerPeriod);
    expect(villagerPos(afterTwo)).toEqual({ x: home[0], y: home[1] });
  });

  test("villager stays put while the period has not elapsed", () => {
    const state = newGame(42, "rim");
    const { zone } = dormantZone(state);
    const handle = villagerHandle(zone.world);
    const sched = getComponent(zone.world, handle, "schedule");
    if (sched === undefined) {
      throw new Error("test: villager has no schedule");
    }
    const turnsPerPeriod = sched.period / 100;
    const before = villagerPos(state);
    // One WAIT short of a period: the schedule event hasn't fired yet.
    const partial = waitN(state, turnsPerPeriod - 1);
    expect(villagerPos(partial)).toEqual(before);
  });

  test("village schedule event stays on the heap, rescheduled at period intervals", () => {
    const state = newGame(42, "rim");
    const { zone } = dormantZone(state);
    const handle = villagerHandle(zone.world);
    const sched = getComponent(zone.world, handle, "schedule");
    if (sched === undefined) {
      throw new Error("test: villager has no schedule");
    }
    const turnsPerPeriod = sched.period / 100;
    let s = state;
    // Drive five full periods. The heap size should never grow or shrink —
    // each application pops the village event and immediately reschedules.
    const initialSize = size(s.globalScheduler);
    for (let i = 0; i < 5; i++) {
      s = waitN(s, turnsPerPeriod);
      expect(size(s.globalScheduler)).toBe(initialSize);
    }
  });
});

describe("tick: zone-state bookkeeping", () => {
  test("dormant zone's lastSimAt advances to each fired event's time", () => {
    const state = newGame(42, "rim");
    const { id, zone } = dormantZone(state);
    const handle = villagerHandle(zone.world);
    const sched = getComponent(zone.world, handle, "schedule");
    if (sched === undefined) {
      throw new Error("test: villager has no schedule");
    }
    const turnsPerPeriod = sched.period / 100;
    expect(zone.lastSimAt).toBe(0);
    const after1 = waitN(state, turnsPerPeriod);
    const after1Zone = after1.zones.get(id);
    if (after1Zone === undefined || after1Zone.kind !== "dormant") {
      throw new Error("test: zone is no longer dormant");
    }
    expect(after1Zone.lastSimAt).toBe(sched.period);
    const after2 = waitN(after1, turnsPerPeriod);
    const after2Zone = after2.zones.get(id);
    if (after2Zone === undefined || after2Zone.kind !== "dormant") {
      throw new Error("test: zone is no longer dormant");
    }
    expect(after2Zone.lastSimAt).toBe(2 * sched.period);
  });
});

describe("determinism: village abstract pipeline", () => {
  test("same seed produces identical villager trajectories over many ticks", () => {
    function trajectory(seed: number): Pos[] {
      let s = newGame(seed, "rim");
      const out: Pos[] = [villagerPos(s)];
      for (let i = 0; i < 30; i++) {
        s = tick(s, { type: "WAIT" });
        out.push(villagerPos(s));
      }
      return out;
    }
    for (const seed of [1, 7, 42, 0xdead, 0xbeef]) {
      expect(trajectory(seed)).toEqual(trajectory(seed));
    }
  });
});

describe("tick: stale-handle lazy skip on schedule events", () => {
  test("despawning the villager before its schedule fires does not crash the tick", () => {
    const state = newGame(42, "rim");
    const { zone } = dormantZone(state);
    const villager = villagerHandle(zone.world);
    despawn(zone.world, villager);
    // The schedule event for the despawned villager is still on the heap.
    // The drain must lazy-skip it without throwing when the period elapses.
    expect(() => waitN(state, 10)).not.toThrow();
  });

  test("removing the villager's `schedule` component drops it from the heap on next pop", () => {
    const state = newGame(42, "rim");
    const { zone } = dormantZone(state);
    const villager = villagerHandle(zone.world);
    removeComponent(zone.world, villager, "schedule");
    // Burn through 10 periods worth of game-time. The de-scheduled villager's
    // event must not zombie-cycle: heap size drops by 1 once its event fires
    // and the resolver returns "no schedule, no reschedule".
    const initialSize = size(state.globalScheduler);
    const after = waitN(state, 50);
    expect(size(after.globalScheduler)).toBe(initialSize - 1);
  });
});
