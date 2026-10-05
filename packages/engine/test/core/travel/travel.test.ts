import { expect, test } from "bun:test";
import { defineModule, type EntityId } from "../../../src/core/api";
import { STAIR_TIME } from "../../../src/core/config";
import { FLOOR_STAGE } from "../../../src/core/engine";
import { spawn } from "../../../src/core/lifecycle/lifecycle";
import { createEngine } from "../../../src/core/setup/registration";
import { depart } from "../../../src/core/travel/travel";
import { createWorld, loadWorld } from "../../../src/core/world";
import { probe } from "../../fixtures";
import {
	aimAt,
	box,
	climber,
	climberBody,
	drain,
	SIDE,
	stairsTo,
	TURN,
	twoFloors,
} from "./climber";

test("an actor beside stairs leaves and arrives on the linked floor at departure + STAIR_TIME, same id", () => {
	aimAt("stairs");
	const world = twoFloors();
	world.spawn(0, stairsTo(1, 5, 6), 2, 2);
	const id = world.spawn(0, climberBody, 3, 3);
	world.runRounds(1);
	const left = drain(world, 0, "core/departed");
	expect(left).toEqual([{ id, time: 0, b: 1 }]);
	expect(world.alive(id)).toBe(false);
	world.runRounds(3);
	expect(drain(world, 1, "core/arrived")).toEqual([
		{ id, time: STAIR_TIME, b: 0 },
	]);
	expect(world.alive(id)).toBe(true);
	expect([world.peek("where", "x", id), world.peek("where", "y", id)]).toEqual([
		5, 6,
	]);
});

for (const [why, kind] of [
	["two cells away", "far"],
	["not stairs", "food"],
] as const)
	test(`travel fails when the target is ${why}`, () => {
		aimAt(kind);
		const world = twoFloors();
		if (kind === "far") world.spawn(0, stairsTo(1, 1, 1), 1, 1);
		else world.spawn(0, box, 2, 2);
		const id = world.spawn(0, climberBody, 3, 3);
		world.runRounds(4);
		expect(drain(world, 0, "core/departed")).toEqual([]);
		expect(world.alive(id)).toBe(true);
		expect(world.peek("where", "x", id)).toBe(3);
	});

test("in transit, the id resolves to no slot on any floor", () => {
	aimAt("stairs");
	const seen: boolean[] = [];
	let watched = 0 as EntityId;
	const watcher = defineModule({
		name: "watcher",
		schema: {},
		config: {},
		setup(b) {
			b.tick((ctx) => {
				seen.push(ctx.isAlive(watched) || ctx.slotOf(watched) !== -1);
			});
		},
	});
	const world = createWorld({
		seed: 1,
		floors: 3,
		width: SIDE,
		height: SIDE,
		modules: [climber, probe, watcher],
	});
	world.spawn(0, stairsTo(2, 5, 5), 2, 2);
	watched = world.spawn(0, climberBody, 3, 3);
	// Floor 0 ticks before the climber leaves at time 0; it lands on floor 2 before round 1's ticks.
	world.runRounds(1);
	expect(seen).toEqual([true, false, false]);
	world.runRounds(1);
	expect(seen.slice(3)).toEqual([false, false, true]);
});

test("arrival clears the intent: the old target gets no inertia on the new floor", () => {
	aimAt("stairs");
	const world = twoFloors();
	const stairs = world.spawn(0, stairsTo(1, 5, 5), 2, 2);
	const id = world.spawn(0, climberBody, 3, 3);
	// Lands at STAIR_TIME and marks every turn after: a kept travel intent would win the first
	// one through inertia (100 + INERTIA > 103) and fail on the stairs it left behind.
	world.runRounds(3);
	expect(world.alive(stairs)).toBe(true);
	expect(world.peek("climbs", "marks", id)).toBe(2);
	// Its first turn on the new floor is at its arrival time, not at the round's start.
	expect(drain(world, 1, "climber/marked").map((m) => m.time)).toEqual([
		STAIR_TIME,
		STAIR_TIME + TURN,
	]);
});

test("travel to a link names its own floor or leaves the floor: the spawn throws", () => {
	const world = twoFloors();
	expect(() => world.spawn(0, stairsTo(0, 1, 1), 2, 2)).toThrow(/link/);
	expect(() => world.spawn(0, stairsTo(2, 1, 1), 2, 2)).toThrow(/link/);
	expect(() => world.spawn(0, stairsTo(1, SIDE, 1), 2, 2)).toThrow(/link/);
	expect(() =>
		world.spawn(
			0,
			{ actor: true, components: { link: { floor: 1, x: 1, y: 1 } } },
			2,
			2,
		),
	).toThrow(/link/);
});

const transit = (seed: number) => {
	aimAt("stairs");
	const world = twoFloors(seed);
	world.spawn(0, stairsTo(1, 4, 4), 3, 3);
	world.spawn(1, stairsTo(0, 3, 3), 4, 4);
	for (const [x, y] of [
		[2, 2],
		[3, 2],
		[4, 2],
		[2, 4],
	] as const)
		world.spawn(0, climberBody, x, y);
	return world;
};

test("the inbox survives save and load mid-transit", () => {
	const straight = transit(3);
	straight.runRounds(12);
	const first = transit(3);
	first.runRounds(1);
	const resumed = loadWorld(first.save(), { modules: [climber, probe] });
	expect(resumed.save()).toEqual(first.save());
	resumed.runRounds(11);
	expect(resumed.hash()).toBe(straight.hash());
});

test("a departure the receiving floor has already passed throws", () => {
	const make = (round: number, stage: number) => {
		const e = createEngine(
			{
				seed: 1,
				floors: 2,
				width: SIDE,
				height: SIDE,
				popCap: 8,
				events: true,
			},
			[climber, probe],
		);
		const slot = e.storage.slotOf(0, spawn(e, 0, climberBody, 3, 3, 0));
		e.round = round;
		e.stage[1] = stage;
		e.leaveFloor = 1;
		return () => depart(e, 0, slot, 0);
	};
	// Leaving at 0 lands at STAIR_TIME: in round 1, after floor 1 ingested it.
	expect(make(1, FLOOR_STAGE.waiting)).not.toThrow();
	expect(make(1, FLOOR_STAGE.acting)).toThrow(/has passed/);
	expect(make(2, FLOOR_STAGE.waiting)).toThrow(/has passed/);
});

test("audit mode accepts departures and arrivals", () => {
	aimAt("stairs");
	const world = createWorld({
		seed: 1,
		floors: 2,
		width: SIDE,
		height: SIDE,
		modules: [climber, probe],
		audit: true,
	});
	world.spawn(0, stairsTo(1, 4, 4), 3, 3);
	world.spawn(1, stairsTo(0, 3, 3), 4, 4);
	const id = world.spawn(0, climberBody, 2, 2);
	world.runRounds(6);
	expect(drain(world, 1, "core/arrived").map((m) => m.id)).toContain(id);
});

test("an actor that dies in the turn it takes the stairs never leaves", () => {
	let stairs = 0 as EntityId;
	const doomed = defineModule({
		name: "doomed",
		schema: { doom: {} },
		config: {},
		setup(b) {
			const rows = b.query(["doom"]);
			const jump = b.action("jump", "none", (ctx, actor) => {
				ctx.kill(ctx.idOf(actor), ctx.idOf(actor));
				return ctx.instead(ctx.travel, stairs);
			});
			b.propose((_ctx, actor, _p, out) => {
				if (rows.has(actor)) out.push(jump, null, 1);
			});
		},
	});
	const world = createWorld({
		seed: 1,
		floors: 2,
		width: SIDE,
		height: SIDE,
		modules: [doomed],
	});
	stairs = world.spawn(0, stairsTo(1, 4, 4), 3, 3);
	const id = world.spawn(0, { actor: true, components: { doom: {} } }, 2, 2);
	const other = world.spawn(0, { actor: true, components: {} }, 5, 5);
	world.runRounds(3);
	expect(drain(world, 0, "core/departed")).toEqual([]);
	expect(world.alive(id)).toBe(false);
	expect(world.locate(id)).toBe("dead");
	expect(world.alive(other)).toBe(true);
	expect(loadWorld(world.save(), { modules: [doomed] }).hash()).toBe(
		world.hash(),
	);
});

test("locate tells where an entity is: on a floor, in transit, or dead", () => {
	aimAt("stairs");
	const world = twoFloors();
	world.spawn(0, stairsTo(1, 5, 6), 2, 2);
	const id = world.spawn(0, climberBody, 3, 3);
	expect(world.locate(id)).toEqual({ floor: 0, x: 3, y: 3 });
	world.runRounds(1);
	expect(world.locate(id)).toBe("transit");
	world.runRounds(1);
	expect(world.locate(id)).toEqual({ floor: 1, x: 5, y: 6 });
	expect(world.locate((id + 1000) as EntityId)).toBe("dead");
});
