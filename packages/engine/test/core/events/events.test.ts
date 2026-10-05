import { expect, test } from "bun:test";
import { cheese } from "../../../src/content/species/cheese";
import { moss } from "../../../src/content/species/moss";
import { rat } from "../../../src/content/species/rat";
import {
	type AnyModule,
	defineModule,
	type EntityId,
} from "../../../src/core/api";
import { EVENT_CAP_PER_TURN } from "../../../src/core/config";
import { hashName } from "../../../src/core/random/rng";
import { createWorld, loadWorld, type World } from "../../../src/core/world";
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

test("tick facts keep registry order: a starved rat, then a sprout's yield", () => {
	const world = smallWorld();
	const sprout = world.spawn(
		0,
		{ ...moss, components: { sprout: { period: 5, left: 1 } } },
		6,
		6,
	);
	const starving = world.spawn(0, ratAt(1), 1, 1);
	drained(world);
	world.runRounds(2);
	expect(drained(world)).toEqual([
		[world.eventType("core/died"), starving, starving, 0, 0],
		[world.eventType("core/spawned"), sprout, starving + 1, 0, 0],
	]);
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

test("an action's event carries the actor's own time, not the round start", () => {
	const SLOW = 150;
	const pulse = defineModule({
		name: "pulse",
		schema: { beat: { v: "u8" } },
		config: {},
		setup(b) {
			const beat = b.event("beat");
			const go = b.action("go", "none", (ctx, actor) => {
				ctx.emit(beat, ctx.idOf(actor), 0, 0);
				return SLOW;
			});
			b.propose((_ctx, _actor, _p, out) => out.push(go, null, 1));
		},
	});
	const world = createWorld({
		seed: 1,
		floors: 1,
		width: 4,
		height: 4,
		modules: [pulse],
	});
	world.spawn(0, { actor: true, components: { beat: {} } }, 0, 0);
	world.runRounds(4);
	const beat = world.eventType("pulse/beat");
	const times = drained(world)
		.filter(([type]) => type === beat)
		.map(([, , , , time]) => time);
	expect(times).toEqual([0, 150, 300]);
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

test("the per-turn event cap throws, with emission off too", () => {
	for (const events of [true, false]) {
		expect(() =>
			loudWorld(EVENT_CAP_PER_TURN, events).runRounds(2),
		).not.toThrow();
		expect(() =>
			loudWorld(EVENT_CAP_PER_TURN + 1, events).runRounds(1),
		).toThrow(/events/);
	}
});

test("a growing ring keeps every event in order", () => {
	const COUNT = 3000;
	const world = loudWorld(COUNT, true);
	world.runRounds(1);
	const order: number[] = [];
	world.drainEvents(0, (_type, _cause, a) => order.push(a));
	expect(order).toEqual(Array.from({ length: COUNT }, (_, i) => i));
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

// Two creatures each emit just over half a turn's cap; a player stands between them in line.
const HALF = EVENT_CAP_PER_TURN / 2 + 1;
const shouting = defineModule({
	name: "shouting",
	schema: { loud: { n: "i32" } },
	config: {},
	setup(b) {
		const rows = b.query(["loud"]);
		const counts = b.write("loud");
		const shout = b.event("shout");
		const yell = b.action("yell", "none", (ctx, actor) => {
			for (let i = 0; i < (counts.n[actor] ?? 0); i++)
				ctx.emit(shout, ctx.idOf(actor), 0, 0);
			return 100;
		});
		b.propose((_ctx, actor, _p, out) => {
			if (rows.has(actor)) out.push(yell, null, 1);
		});
	},
});
const pausedLoud = () => {
	const world = createWorld({
		seed: 1,
		floors: 1,
		width: 4,
		height: 4,
		events: false,
		modules: [shouting],
	});
	const shouter = { actor: true, components: { loud: { n: HALF } } };
	world.spawn(0, shouter, 0, 0);
	const player = world.spawnPlayer(0, { actor: true, components: {} }, 1, 0);
	world.spawn(0, shouter, 2, 0);
	expect(world.advance()).toEqual([player]);
	return { world, player };
};

test("a load mid-round keeps the round's event count, so the cap throws at the same point", () => {
	const straight = pausedLoud();
	straight.world.input(straight.player, "core/idle", null);
	expect(() => straight.world.advance()).toThrow(/emitted more than/);
	const paused = pausedLoud();
	const loaded = loadWorld(paused.world.save(), { modules: [shouting] });
	loaded.input(paused.player, "core/idle", null);
	expect(() => loaded.advance()).toThrow(/emitted more than/);
});
