import { expect, test } from "bun:test";
import { cheese } from "../../../src/content/species/cheese";
import { moss } from "../../../src/content/species/moss";
import { rat } from "../../../src/content/species/rat";
import { EVENT_CAP_PER_TURN } from "../../../src/core/config";
import {
	type AnyModule,
	defineModule,
	type EntityId,
} from "../../../src/core/module/api";
import { hashName } from "../../../src/core/random/rng";
import { createWorld, type World } from "../../../src/core/world/world";
import { flora } from "../../../src/modules/flora";
import { hunger } from "../../../src/modules/hunger";
import { hungerConfig } from "../../../src/modules/hunger/config";
import { wander } from "../../../src/modules/wander";
import { modules } from "../../../src/registry";
import { game, populatedWorld } from "../../fixtures";

const ratAt = (satiety: number) => ({
	...rat,
	components: { ...rat.components, satiety: { value: satiety } },
});
const smallWorld = (events = true) =>
	createWorld({ seed: 1, floors: 1, width: 8, height: 8, events, ...game });

const drained = (world: World<readonly AnyModule[]>, floor = 0) => {
	const seen: number[][] = [];
	world.drainEvents(floor, (type, cause, a, b, time) =>
		seen.push([type, cause, a, b, time]),
	);
	return seen;
};

const NO_CAUSE = 0 as EntityId;

test("eating records ate, then the food's death, both caused by the eater", () => {
	const world = smallWorld();
	const eater = world.spawn(0, ratAt(hungerConfig.hungryBelow - 100), 2, 2);
	const food = world.spawn(0, cheese, 3, 2);
	drained(world);
	world.runRounds(1);
	const nutrition = cheese.components.edible.nutrition;
	expect(drained(world)).toEqual([
		[world.eventType("hunger/ate"), eater, food, nutrition, 0],
		[world.eventType("core/died"), eater, food, 0, 0],
	]);
	expect(drained(world)).toEqual([]);
});

test("a direct spawn records core/spawned with no cause", () => {
	const world = smallWorld();
	world.runRounds(3);
	const id = world.spawn(0, cheese, 1, 1);
	expect(drained(world)).toEqual([
		[world.eventType("core/spawned"), NO_CAUSE, id, 0, 300],
	]);
});

test("a target killed twice in one batch dies once, by the lower cause", () => {
	let fired = false;
	const twice = defineModule({
		name: "twice",
		schema: { mark: { v: "u8" } },
		config: {},
		setup(b) {
			b.tick((ctx) => {
				if (fired) return;
				fired = true;
				ctx.kill(1 as EntityId, 7 as EntityId);
				ctx.kill(1 as EntityId, 3 as EntityId);
			});
		},
	});
	const world = createWorld({
		seed: 1,
		floors: 1,
		width: 4,
		height: 4,
		modules: [twice],
	});
	world.spawn(0, { actor: false, components: { mark: {} } }, 0, 0);
	drained(world);
	world.runRounds(1);
	expect(drained(world)).toEqual([[world.eventType("core/died"), 3, 1, 0, 0]]);
});

test("event types are name keys, the same in any registry", () => {
	const [first, second] = [
		[hunger, wander, flora],
		[flora, wander, hunger],
	].map((list) =>
		createWorld({
			seed: 1,
			floors: 1,
			width: 4,
			height: 4,
			modules: list,
			species: { mushroom: game.species.mushroom },
		}).eventType("hunger/ate"),
	);
	expect(first).toBe(hashName("hunger/ate") | 0);
	expect(second).toBe(first);
	expect(() => smallWorld().eventType("hunger/nope")).toThrow(/no event/);
});

test("the world hash is the same with events on and off", () => {
	const on = populatedWorld(1, modules, 50, { events: true }).world;
	const off = populatedWorld(1, modules, 50, { events: false }).world;
	for (let i = 0; i < 8; i++) {
		on.spawn(0, moss, i * 4, 3);
		off.spawn(0, moss, i * 4, 3);
	}
	on.runRounds(300);
	off.runRounds(300);
	expect(drained(off)).toEqual([]);
	expect(drained(on).length).toBeGreaterThan(0);
	// The switch itself is world state and hashed; with it aligned, the floors must match.
	expect(off.hash()).not.toBe(on.hash());
	off.setEvents(0, true);
	expect(off.hash()).toBe(on.hash());
});

const loud = (perTurn: number) =>
	defineModule({
		name: "loud",
		schema: {},
		config: {},
		setup(b) {
			const ping = b.event("ping");
			b.tick((ctx) => {
				for (let i = 0; i < perTurn; i++) ctx.emit(ping, NO_CAUSE, i, 0);
			});
		},
	});
const loudWorld = (perTurn: number, events: boolean) =>
	createWorld({
		seed: 1,
		floors: 1,
		width: 4,
		height: 4,
		events,
		modules: [loud(perTurn)],
	});

test("undrained events are overwritten oldest first", () => {
	const world = loudWorld(EVENT_CAP_PER_TURN, true);
	world.runRounds(2);
	const times: number[] = [];
	const order: number[] = [];
	world.drainEvents(0, (_type, _cause, a, _b, time) => {
		times.push(time);
		order.push(a);
	});
	expect(times.length).toBe(EVENT_CAP_PER_TURN);
	expect(new Set(times)).toEqual(new Set([100]));
	expect(order.every((a, i) => a === i)).toBe(true);
});

test("events can be switched per floor", () => {
	const world = createWorld({
		seed: 1,
		floors: 2,
		width: 4,
		height: 4,
		events: false,
		...game,
	});
	world.setEvents(1, true);
	world.spawn(0, ratAt(1), 1, 1);
	world.spawn(1, ratAt(1), 1, 1);
	drained(world, 1);
	world.runRounds(1);
	expect([drained(world, 0).length, drained(world, 1).length]).toEqual([0, 1]);
});

test("a fractional event payload throws", () => {
	const fuzzy = defineModule({
		name: "fuzzy",
		schema: {},
		config: {},
		setup(b) {
			const ping = b.event("ping");
			b.tick((ctx) => ctx.emit(ping, NO_CAUSE, 0.5, 0));
		},
	});
	const world = createWorld({
		seed: 1,
		floors: 1,
		width: 4,
		height: 4,
		modules: [fuzzy],
	});
	expect(() => world.runRounds(1)).toThrow(/integer/);
});

test("an event name declared twice by one module throws", () => {
	const twice = defineModule({
		name: "twice",
		schema: {},
		config: {},
		setup(b) {
			b.event("x");
			b.event("x");
		},
	});
	expect(() =>
		createWorld({ seed: 1, floors: 1, width: 4, height: 4, modules: [twice] }),
	).toThrow(/duplicate event/);
});

test("a throwing visitor consumes only the events it was shown", () => {
	const world = loudWorld(5, true);
	world.runRounds(1);
	const seen: number[] = [];
	expect(() =>
		world.drainEvents(0, (_type, _cause, a) => {
			seen.push(a);
			if (a === 2) throw new Error("visitor broke");
		}),
	).toThrow(/visitor broke/);
	world.drainEvents(0, (_type, _cause, a) => seen.push(a));
	expect(seen).toEqual([0, 1, 2, 3, 4]);
});

test("the world cannot change while it drains events", () => {
	const world = smallWorld();
	world.spawn(0, cheese, 1, 1);
	const attempts: (() => unknown)[] = [
		() => world.spawn(0, cheese, 2, 2),
		() => world.runRounds(1),
		() => world.setEvents(0, false),
		() => world.drainEvents(0, () => {}),
	];
	const errors: string[] = [];
	world.drainEvents(0, () => {
		for (const attempt of attempts)
			try {
				attempt();
			} catch (error) {
				errors.push((error as Error).message);
			}
	});
	expect(errors.length).toBe(attempts.length);
	for (const message of errors) expect(message).toMatch(/draining/);
	expect(() => world.runRounds(1)).not.toThrow();
});
