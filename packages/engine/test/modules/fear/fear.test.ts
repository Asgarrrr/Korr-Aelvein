import { expect, test } from "bun:test";
import { species } from "../../../src/content/species";
import { cheese } from "../../../src/content/species/cheese";
import { ember } from "../../../src/content/species/ember";
import { rat } from "../../../src/content/species/rat";
import { stoat } from "../../../src/content/species/stoat";
import {
	type ActionCtx,
	type ActionFn,
	ALTERNATE,
	type AnyModule,
	type Builder,
	type EntityId,
	FAIL,
	type Perception,
	type Slot,
} from "../../../src/core/module/api";
import { bounded, draw, PHASE, SUBJECT } from "../../../src/core/random/rng";
import { createWorld } from "../../../src/core/world/world";
import { fear } from "../../../src/modules/fear";
import { fearConfig } from "../../../src/modules/fear/config";
import { foodClass, hungerConfig } from "../../../src/modules/hunger/config";
import { wander } from "../../../src/modules/wander";
import { modules } from "../../../src/registry";
import { probe } from "../../fixtures";

const tracked = <T extends { components: object }>(shape: T) => ({
	...shape,
	components: { ...shape.components, where: {} },
});
const withSatiety = <T extends { components: object }>(
	shape: T,
	value: number,
) => ({ ...shape, components: { ...shape.components, satiety: { value } } });

const worldOf = (list: readonly AnyModule[], side = 16, seed = 1) =>
	createWorld({
		seed,
		floors: 1,
		width: side,
		height: side,
		modules: [...list, probe],
		species,
	});
type AnyWorld = ReturnType<typeof worldOf>;
// `where` holds the position at the start of the last round run.
const cellOf = (world: AnyWorld, id: EntityId) => [
	world.peek("where", "x", id),
	world.peek("where", "y", id),
];

test("a rat next to a stoat steps to the free cell farthest from it", () => {
	const world = worldOf(modules);
	const prey = world.spawn(0, tracked(rat), 5, 5);
	world.spawn(0, stoat, 6, 5);
	world.runRounds(2);
	expect(cellOf(world, prey)).toEqual([4, 5]);
});

test("a rat steps around another rat when fleeing", () => {
	const world = worldOf(modules);
	const prey = world.spawn(0, tracked(rat), 5, 5);
	world.spawn(0, rat, 4, 5);
	world.spawn(0, stoat, 6, 5);
	world.runRounds(2);
	expect(cellOf(world, prey)).toEqual([4, 4]);
});

test("a rat steps around any actor, eater or not", () => {
	const world = worldOf(modules);
	const prey = world.spawn(0, tracked(rat), 5, 5);
	world.spawn(0, { actor: true, components: {} }, 4, 5);
	world.spawn(0, stoat, 6, 5);
	world.runRounds(2);
	expect(cellOf(world, prey)).toEqual([4, 4]);
});

const chebyshev = (a: number[], b: readonly number[]) =>
	Math.max(
		Math.abs((a[0] ?? 0) - (b[0] ?? 0)),
		Math.abs((a[1] ?? 0) - (b[1] ?? 0)),
	);

test("a cornered rat never steps closer to a stoat", () => {
	const world = worldOf(modules);
	const starts = [
		[0, 0],
		[0, 1],
		[1, 1],
	] as const;
	const stoats = [
		[2, 0],
		[3, 0],
	] as const;
	const rats = starts.map(([x, y]) => world.spawn(0, tracked(rat), x, y));
	for (const [x, y] of stoats) world.spawn(0, stoat, x, y);
	world.runRounds(2);
	const nearest = (cell: readonly number[]) =>
		Math.min(...stoats.map((s) => chebyshev([...cell], s)));
	for (let i = 0; i < rats.length; i++)
		expect(nearest(cellOf(world, rats[i] as EntityId))).toBeGreaterThanOrEqual(
			nearest(starts[i] as readonly number[]),
		);
});

test("an edible creature that is not wary stays calm next to a stoat", () => {
	const { satiety, diet, edible } = rat.components;
	const calm = { actor: true, components: { satiety, diet, edible } };
	const path = (list: readonly AnyModule[]) => {
		const world = worldOf(list);
		const id = world.spawn(0, tracked(calm), 5, 5);
		world.spawn(0, stoat, 6, 5);
		world.runRounds(3);
		return cellOf(world, id);
	};
	expect(path(modules)).toEqual(path(modules.filter((m) => m !== fear)));
});

test("a rat against the edge of the floor flees along it", () => {
	const world = worldOf(modules);
	const prey = world.spawn(0, tracked(rat), 0, 5);
	world.spawn(0, stoat, 1, 4);
	world.runRounds(2);
	expect(cellOf(world, prey)).toEqual([0, 6]);
});

test("a rat flanked by two stoats sidesteps rather than near the farther one", () => {
	const world = worldOf(modules);
	const prey = world.spawn(0, tracked(rat), 5, 5);
	world.spawn(0, stoat, 6, 5);
	world.spawn(0, stoat, 2, 5);
	world.runRounds(2);
	expect(cellOf(world, prey)).toEqual([5, 4]);
});

test("with no predator in sight, fear changes nothing", () => {
	const path = (list: readonly AnyModule[]) => {
		const world = worldOf(list);
		const ids = [0, 1, 2, 3].map((i) => world.spawn(0, tracked(rat), 5 + i, 5));
		world.runRounds(20);
		return ids.map((id) => cellOf(world, id));
	};
	expect(path(modules)).toEqual(path(modules.filter((m) => m !== fear)));
});

test("a rat with nowhere safe to go does not flee: it eats instead", () => {
	const world = worldOf(modules);
	world.spawn(0, withSatiety(rat, hungerConfig.hungryBelow - 100), 0, 0);
	const food = world.spawn(0, cheese, 0, 0);
	world.spawn(0, rat, 1, 0);
	world.spawn(0, rat, 0, 1);
	world.spawn(0, stoat, 1, 1);
	world.runRounds(1);
	expect(world.alive(food)).toBe(false);
});

test("a starving rat beside food still flees a stoat", () => {
	const world = worldOf(modules);
	const prey = world.spawn(0, tracked(withSatiety(rat, 10)), 5, 5);
	const food = world.spawn(0, cheese, 5, 4);
	world.spawn(0, stoat, 6, 5);
	world.runRounds(2);
	expect(world.alive(food)).toBe(true);
	expect(cellOf(world, prey)).toEqual([4, 5]);
});

const SIDE = 24;
const RATS = 24;
const STOATS = 4;
const CHEESE = 40;
const ROUNDS = 150;
const SEEDS = 20;

const ratsAlive = (seed: number, list: readonly AnyModule[]) => {
	const world = createWorld({
		seed,
		floors: 1,
		width: SIDE,
		height: SIDE,
		modules: list,
		species,
	});
	let n = 0;
	const coord = () =>
		bounded(draw(seed, 0, PHASE.spawn, 0, SUBJECT.entity, 0, n++), SIDE);
	const taken = new Set<number>();
	const free = () => {
		for (;;) {
			const x = coord();
			const y = coord();
			if (taken.has(y * SIDE + x)) continue;
			taken.add(y * SIDE + x);
			return [x, y] as const;
		}
	};
	const rats: EntityId[] = [];
	for (let i = 0; i < RATS; i++) rats.push(world.spawn(0, rat, ...free()));
	const hungryStoat = withSatiety(stoat, hungerConfig.hungryBelow - 1);
	for (let i = 0; i < STOATS; i++) world.spawn(0, hungryStoat, ...free());
	for (let i = 0; i < CHEESE; i++) world.spawn(0, cheese, coord(), coord());
	world.runRounds(ROUNDS);
	return rats.filter((id) => world.alive(id)).length;
};

const median = (values: number[]) =>
	[...values].sort((a, b) => a - b)[values.length >> 1] ?? 0;

test("fear saves prey: more rats survive stoats with fear than without", () => {
	const seeds = [...Array(SEEDS).keys()].map((i) => i + 1);
	const without = modules.filter((m) => m !== fear);
	const afraid = median(seeds.map((seed) => ratsAlive(seed, modules)));
	const fearless = median(seeds.map((seed) => ratsAlive(seed, without)));
	expect(afraid).toBeGreaterThan(fearless);
});

test("the game runs without fear, deterministically", () => {
	const without = modules.filter((m) => m !== fear);
	const run = () => {
		const world = worldOf(without, SIDE);
		for (let i = 0; i < 8; i++) {
			world.spawn(0, rat, i * 3, 2);
			world.spawn(0, stoat, i * 3, 5);
			world.spawn(0, cheese, i * 3, 8);
		}
		world.runRounds(ROUNDS);
		return world.hash();
	};
	expect(run()).toBe(run());
});

test("without hunger, fear still sets up and a rat only wanders", () => {
	const path = (list: readonly AnyModule[]) => {
		const world = worldOf(list);
		const prey = world.spawn(0, tracked(rat), 5, 5);
		world.spawn(0, stoat, 6, 5);
		const cells: number[][] = [];
		for (let round = 0; round < 20; round++) {
			world.runRounds(1);
			cells.push(cellOf(world, prey));
		}
		return cells;
	};
	expect(path([fear, wander])).toEqual(path([wander]));
});

// Danger set on every cell, as fear's tick would stamp it around the scene the test builds.
const ALERT = { read: () => ({ get: () => 0xff }) };

// Slot 0 is the prey; slot 1, id THREAT, the creature it may flee.
const THREAT = 9 as EntityId;
const fleeWith = (hunger: boolean) => {
	let flee: ActionFn<"entity"> | undefined;
	const eats = [0, foodClass.meat];
	const classes = [foodClass.meat, 0];
	const builder = {
		read: (name: string) =>
			!hunger
				? undefined
				: name === "diet"
					? { eats: { get: (s: number) => eats[s] ?? 0 } }
					: { class: { get: (s: number) => classes[s] ?? 0 } },
		query: () => ({ has: () => true }),
		cells: () => ({ eats: ALERT, fire: ALERT }),
		tick() {},
		propose() {},
		action: (
			name: string,
			_kind: string,
			_requires: unknown,
			run: ActionFn<"entity">,
		) => {
			if (name === "flee") flee = run;
			return { index: 0 };
		},
	} as unknown as Builder<typeof fear.schema>;
	fear.setup(builder, fearConfig);
	return { run: flee as ActionFn<"entity">, eats };
};
const ctxWith = (crowded = false) =>
	({
		x: () => 5,
		y: () => 5,
		cellAt: (x: number, y: number) => y * 32 + x,
		cellOf: () => 5 * 32 + 5,
		holdsActor: () => crowded,
		instead: () => ALTERNATE,
	}) as unknown as ActionCtx;
// What the actor perceives when the action runs: the threat one cell east, or nothing.
const sight = (seesThreat: boolean) =>
	({
		count: seesThreat ? 1 : 0,
		slot: () => 1,
		id: () => THREAT,
		dx: () => 1,
		dy: () => 0,
		dist: () => 1,
	}) as unknown as Perception;

test("flee runs while it perceives its threat and has somewhere to go", () => {
	const { run } = fleeWith(true);
	expect(run(ctxWith(), 0 as Slot, THREAT, sight(true))).toBe(ALTERNATE);
	expect(run(ctxWith(), 0 as Slot, THREAT, sight(false))).toBe(FAIL);
	expect(run(ctxWith(true), 0 as Slot, THREAT, sight(true))).toBe(FAIL);
	expect(run(ctxWith(), 0 as Slot, (THREAT + 1) as EntityId, sight(true))).toBe(
		FAIL,
	);
});

test("flee fails once its target no longer eats what the actor is, whoever else does", () => {
	const { run, eats } = fleeWith(true);
	eats[1] = foodClass.forage;
	eats[2] = foodClass.meat;
	expect(run(ctxWith(), 0 as Slot, THREAT, sight(true))).toBe(FAIL);
	const crowd = {
		count: 2,
		slot: (i: number) => i + 1,
		id: (i: number) => (i === 0 ? THREAT : THREAT + 1),
		dx: () => 1,
		dy: () => 0,
		dist: () => 1,
	} as unknown as Perception;
	expect(run(ctxWith(), 0 as Slot, THREAT, crowd)).toBe(FAIL);
	expect(run(ctxWith(), 0 as Slot, (THREAT + 1) as EntityId, crowd)).toBe(
		ALTERNATE,
	);
});

test("flee fails without hunger: no creature is a threat then", () => {
	const { run } = fleeWith(false);
	expect(run(ctxWith(), 0 as Slot, THREAT, sight(true))).toBe(FAIL);
});

for (const [action, threat] of [
	[
		"fear/flee",
		{ actor: false, components: { diet: { eats: foodClass.meat } } },
	],
	["fear/avoid", ember],
] as const)
	test(`a player sending ${action} moves only if its body is wary`, () => {
		const after = (wary: boolean) => {
			const world = createWorld({
				seed: 1,
				floors: 1,
				width: 16,
				height: 16,
				modules,
				species,
			});
			const source = world.spawn(0, threat, 5, 5);
			const meat = { nutrition: 1, class: foodClass.meat };
			const components = wary ? { edible: meat, wary: {} } : { edible: meat };
			const player = world.spawnPlayer(0, { actor: true, components }, 6, 5);
			world.advance();
			world.input(player, action, action === "fear/flee" ? source : null);
			return world.locate(player);
		};
		expect(after(true)).not.toEqual({ floor: 0, x: 6, y: 5 });
		expect(after(false)).toEqual({ floor: 0, x: 6, y: 5 });
	});
