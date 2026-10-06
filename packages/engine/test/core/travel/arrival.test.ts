import { expect, test } from "bun:test";
import { defineModule, type EntityId } from "../../../src/core/api";
import { CAP, STAIR_TIME } from "../../../src/core/config";
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
	statue,
	TURN,
	twoFloors,
} from "./climber";

test("an arrival on an occupied link cell takes the first free cell in perception order", () => {
	aimAt("stairs");
	const world = twoFloors();
	world.spawn(0, stairsTo(1, 5, 5), 2, 2);
	const id = world.spawn(0, climberBody, 3, 3);
	world.spawn(1, statue, 5, 5);
	world.spawn(1, statue, 4, 4);
	world.spawn(1, box, 5, 4);
	world.runRounds(3);
	expect([world.peek("where", "x", id), world.peek("where", "y", id)]).toEqual([
		5, 4,
	]);
});

test("arrivals on a floor with no free cell wait in the inbox, in order, until cells free", () => {
	aimAt("stairs");
	let rounds = 0;
	let doomed: EntityId[] = [];
	const reaper = defineModule({
		name: "reaper",
		schema: {},
		config: {},
		setup(b) {
			b.tick((ctx) => {
				if (!ctx.isAlive(doomed[0] ?? (0 as EntityId)) || ++rounds !== 4)
					return;
				for (const id of doomed) ctx.kill(id, id);
			});
		},
	});
	const world = createWorld({
		seed: 1,
		floors: 2,
		width: 2,
		height: 2,
		modules: [climber, probe, reaper],
	});
	world.spawn(0, stairsTo(1, 0, 0), 0, 0);
	const first = world.spawn(0, climberBody, 1, 1);
	const second = world.spawn(0, climberBody, 1, 0);
	world.spawn(1, statue, 0, 0);
	world.spawn(1, statue, 1, 0);
	doomed = [world.spawn(1, statue, 0, 1), world.spawn(1, statue, 1, 1)];
	world.runRounds(4);
	expect([world.alive(first), world.alive(second)]).toEqual([false, false]);
	expect(drain(world, 1, "core/arrived")).toEqual([]);
	world.runRounds(1);
	expect(drain(world, 1, "core/arrived")).toEqual([
		{ id: first, time: 4 * TURN, b: 0 },
		{ id: second, time: 4 * TURN, b: 0 },
	]);
	const at = (id: EntityId) => [
		world.peek("where", "x", id),
		world.peek("where", "y", id),
	];
	expect([at(first), at(second)]).toEqual([
		[0, 1],
		[1, 1],
	]);
});

test("an arrival ignores popCap, and the crowded floor still saves and loads", () => {
	aimAt("stairs");
	const world = createWorld({
		seed: 1,
		floors: 2,
		width: SIDE,
		height: SIDE,
		popCap: 2,
		modules: [climber, probe],
	});
	world.spawn(0, stairsTo(1, 4, 4), 3, 3);
	const id = world.spawn(0, climberBody, 2, 2);
	world.spawn(1, statue, 0, 0);
	world.spawn(1, statue, 7, 7);
	expect(() => world.spawn(1, statue, 5, 0)).toThrow(/popCap/);
	world.runRounds(2);
	expect(world.alive(id)).toBe(true);
	const loaded = loadWorld(world.save(), { modules: [climber, probe] });
	expect(loaded.hash()).toBe(world.hash());
});

test("an arrival on a floor with every slot taken waits in the inbox until a slot frees", () => {
	aimAt("stairs");
	let doomed = 0 as EntityId;
	let rounds = 0;
	const reaper = defineModule({
		name: "reaper",
		schema: {},
		config: {},
		setup(b) {
			b.tick((ctx) => {
				if (ctx.isAlive(doomed) && ++rounds === 3) ctx.kill(doomed, doomed);
			});
		},
	});
	const world = createWorld({
		seed: 1,
		floors: 2,
		width: SIDE,
		height: SIDE,
		modules: [climber, probe, reaper],
	});
	world.spawn(0, stairsTo(1, 4, 4), 3, 3);
	const id = world.spawn(0, climberBody, 2, 2);
	doomed = world.spawn(1, box, 0, 0);
	for (let i = 1; i < CAP; i++) world.spawn(1, box, 0, 0);
	world.runRounds(3);
	expect(world.alive(id)).toBe(false);
	world.runRounds(1);
	expect(drain(world, 1, "core/arrived")).toEqual([
		{ id, time: 3 * TURN, b: 0 },
	]);
});

test("the ticks of a round with an arrival still run at the round's start", () => {
	aimAt("stairs");
	const clock = defineModule({
		name: "clock",
		schema: {},
		config: {},
		setup(b) {
			const ticked = b.event("ticked");
			b.tick((ctx) => ctx.emit(ticked, 0 as EntityId, 0, 0));
		},
	});
	const world = createWorld({
		seed: 1,
		floors: 2,
		width: SIDE,
		height: SIDE,
		modules: [climber, probe, clock],
	});
	world.spawn(0, stairsTo(1, 4, 4), 3, 3);
	world.spawn(0, climberBody, 2, 2);
	world.runRounds(3);
	expect(drain(world, 1, "clock/ticked").map((m) => m.time)).toEqual([
		0,
		TURN,
		2 * TURN,
	]);
});

test("an arrival far from a crowded link cell takes the first free cell of the first free ring", () => {
	aimAt("stairs");
	const world = twoFloors();
	world.spawn(0, stairsTo(1, 1, 1), 3, 3);
	const id = world.spawn(0, climberBody, 2, 2);
	for (let y = 0; y <= 2; y++)
		for (let x = 0; x <= 2; x++) world.spawn(1, statue, x, y);
	world.runRounds(3);
	// Ring 2 around (1, 1) starts on row -1, off the floor; on row 0 only its far cell (3, 0) is in the ring.
	expect(world.locate(id)).toEqual({ floor: 1, x: 3, y: 0 });
});

test("leaving mid-round lands exactly STAIR_TIME later, even on the next round's boundary", () => {
	let paused = false;
	const hasty = defineModule({
		name: "hasty",
		schema: { hurry: {} },
		config: {},
		setup(b) {
			const rows = b.query(["hurry"]);
			const stairs = b.query(["link"]);
			const pause = b.action("pause", "none", [], () => {
				paused = true;
				return TURN / 2;
			});
			b.propose((ctx, actor, perception, out) => {
				if (!rows.has(actor)) return;
				if (!paused) out.push(pause, null, 1);
				else
					for (let i = 0; i < perception.count; i++)
						if (stairs.has(perception.slot(i)))
							out.push(ctx.travel, perception.id(i), 1);
			});
		},
	});
	const world = createWorld({
		seed: 1,
		floors: 2,
		width: SIDE,
		height: SIDE,
		modules: [hasty],
	});
	world.spawn(0, stairsTo(1, 4, 4), 3, 3);
	const id = world.spawn(0, { actor: true, components: { hurry: {} } }, 2, 2);
	world.runRounds(1);
	expect(drain(world, 0, "core/departed")).toEqual([
		{ id, time: TURN / 2, b: 1 },
	]);
	world.runRounds(1);
	expect(world.locate(id)).toBe("transit");
	world.runRounds(1);
	expect(drain(world, 1, "core/arrived")).toEqual([
		{ id, time: TURN / 2 + STAIR_TIME, b: 0 },
	]);
});
