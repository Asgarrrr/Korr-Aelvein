import { expect, test } from "bun:test";
import { species } from "../../../src/content/species";
import { cheese } from "../../../src/content/species/cheese";
import { ember } from "../../../src/content/species/ember";
import { rat } from "../../../src/content/species/rat";
import { stoat } from "../../../src/content/species/stoat";
import { spawn } from "../../../src/core/lifecycle/lifecycle";
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
import {
	bounded,
	draw,
	hashName,
	PHASE,
	SUBJECT,
} from "../../../src/core/random/rng";
import { createEngine } from "../../../src/core/setup/registration";
import { createWorld } from "../../../src/core/world/world";
import { fear } from "../../../src/modules/fear";
import { fearConfig } from "../../../src/modules/fear/config";
import { fire } from "../../../src/modules/fire";
import { foodClass, hungerConfig } from "../../../src/modules/hunger/config";
import { wander } from "../../../src/modules/wander";
import { modules } from "../../../src/registry";
import { probe } from "../../fixtures";
import { gridCtx } from "./scene";

const tracked = { ...rat, components: { ...rat.components, where: {} } };

test("a wary rat beside a burning cell steps straight away from it", () => {
	const world = createWorld({
		seed: 1,
		floors: 1,
		width: 16,
		height: 16,
		modules: [...modules, probe],
		species,
	});
	world.spawn(0, ember, 5, 5);
	const id = world.spawn(0, tracked, 6, 5);
	world.runRounds(2);
	expect([world.peek("where", "x", id), world.peek("where", "y", id)]).toEqual([
		7, 5,
	]);
});

const startOfRound2 = (
	things: readonly [typeof ember | typeof stoat, number, number][],
	from: readonly [number, number],
) => {
	const world = createWorld({
		seed: 1,
		floors: 1,
		width: 16,
		height: 16,
		modules: [...modules, probe],
		species,
	});
	const id = world.spawn(0, tracked, ...from);
	for (const [shape, x, y] of things) world.spawn(0, shape, x, y);
	world.runRounds(2);
	return [world.peek("where", "x", id), world.peek("where", "y", id)];
};

test("a rat between two burning cells sidesteps rather than stays", () => {
	expect(
		startOfRound2(
			[
				[ember, 4, 5],
				[ember, 6, 5],
			],
			[5, 5],
		),
	).toEqual([5, 4]);
});

test("a rat fleeing a stoat with fire behind it sidesteps, never into the fire", () => {
	expect(
		startOfRound2(
			[
				[ember, 4, 5],
				[stoat, 6, 5],
			],
			[5, 5],
		),
	).toEqual([5, 4]);
});

test("a rat with fire on both sides and nowhere safer stays put, unharmed", () => {
	for (let seed = 1; seed <= 20; seed++) {
		const world = createWorld({
			seed,
			floors: 1,
			width: 6,
			height: 1,
			modules,
			species,
		});
		world.spawn(0, ember, 1, 0);
		world.spawn(0, ember, 4, 0);
		const id = world.spawn(0, rat, 2, 0);
		for (let round = 0; round < 6; round++) {
			world.runRounds(1);
			expect({ seed, round, hp: world.peek("vitality", "hp", id) }).toEqual({
				seed,
				round,
				hp: rat.components.vitality.max,
			});
		}
	}
});

test("fire beyond fireRadius does not stop a cornered rat from eating", () => {
	const world = createWorld({
		seed: 1,
		floors: 1,
		width: 8,
		height: 8,
		modules,
		species,
	});
	const hungry = {
		...rat,
		components: {
			...rat.components,
			satiety: { value: hungerConfig.hungryBelow - 100 },
		},
	};
	world.spawn(0, hungry, 0, 0);
	const food = world.spawn(0, cheese, 0, 0);
	world.spawn(0, rat, 1, 0);
	world.spawn(0, rat, 0, 1);
	world.spawn(0, stoat, 1, 1);
	world.spawn(0, ember, fearConfig.fireRadius + 1, 0);
	world.runRounds(1);
	expect(world.alive(food)).toBe(false);
});

const SIDE = 16;
const SEEDS = 6;

const fates = (seed: number, list: readonly AnyModule[], stoats = 0) => {
	const world = createWorld({
		seed,
		floors: 1,
		width: SIDE,
		height: SIDE,
		modules: list,
		species,
	});
	let n = 0;
	const roll = () =>
		bounded(draw(seed, 0, PHASE.spawn, 0, SUBJECT.entity, 0, n++), SIDE);
	const taken = new Set<number>();
	const free = (): [number, number] => {
		for (;;) {
			const x = roll();
			const y = roll();
			if (taken.has(y * SIDE + x)) continue;
			taken.add(y * SIDE + x);
			return [x, y];
		}
	};
	for (let i = 0; i < 6; i++) world.spawn(0, ember, ...free());
	for (let i = 0; i < stoats; i++) world.spawn(0, stoat, ...free());
	const rats: EntityId[] = [];
	for (let i = 0; i < 12; i++) rats.push(world.spawn(0, rat, ...free()));
	world.runRounds(80);
	return rats.map((id) =>
		world.alive(id) ? world.peek("vitality", "hp", id) : "dead",
	);
};

test("wary rats never step into fire, with or without hunger or stoats; without fear, wandering rats do", () => {
	const unhurt = Array(12).fill(rat.components.vitality.max);
	const without = modules.filter((m) => m !== fear);
	let burned = 0;
	for (let seed = 1; seed <= SEEDS; seed++) {
		expect({ seed, fates: fates(seed, modules) }).toEqual({
			seed,
			fates: unhurt,
		});
		expect({ seed, fates: fates(seed, [fire, fear, wander]) }).toEqual({
			seed,
			fates: unhurt,
		});
		expect({ seed, fates: fates(seed, modules, 3) }).toEqual({
			seed,
			fates: unhurt,
		});
		burned += fates(seed, without).filter(
			(f) => f !== rat.components.vitality.max,
		).length;
	}
	expect(burned).toBeGreaterThan(0);
});

// Danger set on every cell, as fear's tick would stamp it around the scene the test builds.
const ALERT = { read: () => ({ get: () => 0xff }) };

test("avoid fails once no cell near burns, even with an eater in sight", () => {
	let avoid: ActionFn<"none"> | undefined;
	let lit = true;
	const side = 32;
	// The actor stands at (5, 5), fire at (6, 5), an eater of its class at (4, 5).
	const builder = {
		read: (name: string) =>
			name === "fire"
				? {
						left: {
							read: () => ({
								get: (cell: number) => (lit && cell === 5 * side + 6 ? 1 : 0),
							}),
						},
					}
				: name === "diet"
					? { eats: { get: (s: number) => (s === 1 ? foodClass.meat : 0) } }
					: { class: { get: (s: number) => (s === 0 ? foodClass.meat : 0) } },
		query: () => ({ has: () => true }),
		write: () => ({ fleeing: new Uint8Array(2) }),
		cells: () => ({ eats: ALERT, near: ALERT }),
		previous: () => ({ eats: ALERT }),
		tick() {},
		propose() {},
		alarm() {},
		action: (
			name: string,
			_kind: string,
			_requires: unknown,
			run: ActionFn<"none">,
		) => {
			if (name === "avoid") avoid = run;
			return { index: 0 };
		},
	} as unknown as Builder<typeof fear.schema>;
	fear.setup(builder, fearConfig);
	const ctx = gridCtx(
		[
			[0, 1 as EntityId, 5, 5],
			[1, 9 as EntityId, 4, 5],
		],
		side,
	);
	const eater = {} as Perception;
	const run = avoid as ActionFn<"none">;
	expect(run(ctx, 0 as Slot, null, eater)).toBe(ALTERNATE);
	lit = false;
	expect(run(ctx, 0 as Slot, null, eater)).toBe(FAIL);
});

test("with fireRadius 0, a burning cell next door is still a threat: rats never step into fire", () => {
	const blind = { ...fear, config: { ...fearConfig, fireRadius: 0 } };
	const list = modules.map((m): AnyModule => (m === fear ? blind : m));
	const unhurt = Array(12).fill(rat.components.vitality.max);
	for (let seed = 1; seed <= SEEDS; seed++)
		expect({ seed, fates: fates(seed, list) }).toEqual({ seed, fates: unhurt });
});

test("a rat that stays put to avoid fire keeps avoid as its intent", () => {
	const engine = createEngine(
		{ seed: 1, floors: 1, width: 6, height: 1, popCap: 16, events: true },
		modules,
		species,
	);
	spawn(engine, 0, ember, 1, 0);
	spawn(engine, 0, ember, 4, 0);
	const id = spawn(engine, 0, rat, 2, 0);
	engine.runRound();
	engine.runRound();
	const slot = engine.storage.slotOf(0, id);
	expect([
		engine.grid.x[slot],
		engine.intentKey[slot],
		engine.intentTarget[slot],
	]).toEqual([2, hashName("fear/avoid") | 0, 0]);
});
