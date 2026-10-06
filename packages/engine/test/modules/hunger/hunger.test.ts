import { expect, test } from "bun:test";
import { species } from "../../../src/content/species";
import { cheese } from "../../../src/content/species/cheese";
import { rat } from "../../../src/content/species/rat";
import {
	type ActionCtx,
	type ActionFn,
	ALTERNATE,
	type Builder,
	type EntityId,
	FAIL,
	NONE,
	type Perception,
	type Slot,
} from "../../../src/core/api";
import { LOD_PERIODS, PERCEPTION_RADIUS } from "../../../src/core/config";
import { createWorld } from "../../../src/core/world";
import { fear } from "../../../src/modules/fear";
import { flora } from "../../../src/modules/flora";
import { hunger } from "../../../src/modules/hunger";
import { foodClass, hungerConfig } from "../../../src/modules/hunger/config";
import { modules } from "../../../src/registry";
import {
	decider,
	decisions,
	game,
	idleRounds,
	populatedWorld,
} from "../../fixtures";

const smallWorld = () =>
	createWorld({
		seed: 1,
		floors: 1,
		width: 16,
		height: 16,
		...game,
	});
const ratAt = (satiety: number) => ({
	...rat,
	components: { ...rat.components, satiety: { value: satiety } },
});

test("a hungry rat walks to cheese at the edge of perception and eats it", () => {
	const world = smallWorld();
	const ratId = world.spawn(0, ratAt(hungerConfig.hungryBelow - 100), 2, 2);
	const food = world.spawn(0, cheese, 2 + PERCEPTION_RADIUS, 2);

	// Two steps close the gap to one cell, the third turn eats.
	world.runRounds(PERCEPTION_RADIUS - 1);
	expect(world.alive(food)).toBe(true);
	world.runRounds(1);
	expect(world.alive(food)).toBe(false);
	expect(world.peek("satiety", "value", ratId)).toBeGreaterThan(
		hungerConfig.hungryBelow,
	);
});

for (const start of [
	rat.components.satiety.value,
	hungerConfig.decayPerTurn * 100,
]) {
	test(`a rat starting at ${start} starves at exactly ceil(start / decay) rounds`, () => {
		const deathRound = Math.ceil(start / hungerConfig.decayPerTurn);
		const world = smallWorld();
		const ratId = world.spawn(0, ratAt(start), 8, 8);

		world.runRounds(deathRound - 1);
		expect(world.alive(ratId)).toBe(true);
		world.runRounds(1);
		expect(world.alive(ratId)).toBe(false);
	});
}

test("rats with different reserves starve in their own rounds", () => {
	const starts = [3, 30, 31, 60, 61, 90, 33, 4];
	const world = smallWorld();
	const ids = starts.map((s, i) => world.spawn(0, ratAt(s), i * 2, i));
	const diedAt = new Map<EntityId, number>();
	for (let round = 1; round <= 31; round++) {
		world.runRounds(1);
		for (const id of ids)
			if (!world.alive(id) && !diedAt.has(id)) diedAt.set(id, round);
	}
	expect(ids.map((id) => diedAt.get(id))).toEqual(
		starts.map((s) => Math.ceil(s / hungerConfig.decayPerTurn)),
	);
});

test("eat steps toward far food, fails on itself or a class it does not eat", () => {
	const satiety = { value: new Int32Array(4) };
	const edible = { nutrition: new Int16Array(4), class: new Uint8Array(4) };
	const diet = { eats: new Uint8Array(4) };
	const owned: Record<string, object> = { satiety, edible, diet };
	let eat: ActionFn<"entity"> | undefined;
	const builder = {
		write: (name: string) => owned[name],
		query: () => ({ has: () => true }),
		tick() {},
		propose() {},
		event: () => ({ index: 0 }),
		action: (
			_name: string,
			_kind: string,
			_requires: unknown,
			run: ActionFn<"entity">,
		) => {
			eat = run;
			return { index: 0 };
		},
	} as unknown as Builder<typeof hunger.schema>;
	hunger.setup(builder, hungerConfig);

	const xs = [0, 2, 1, 1];
	const killed: number[] = [];
	const steps: number[] = [];
	const step = { index: 9 };
	const ctx = {
		step,
		slotOf: (id: number) => (id >= 1 && id <= 4 ? id - 1 : NONE),
		idOf: (slot: number) => slot + 1,
		x: (slot: number) => xs[slot] ?? 0,
		y: () => 0,
		// The free cell west of the target: the actor here always stands west of its meal.
		approach: (_actor: number, x: number, y: number) => y * 16 + x - 1,
		kill: (id: number) => killed.push(id),
		emit() {},
		instead: (action: unknown, cell: number) => {
			if (action === step) steps.push(cell);
			return ALTERNATE;
		},
	} as unknown as ActionCtx;
	diet.eats[0] = foodClass.forage;
	edible.class[0] = foodClass.forage;
	for (const slot of [1, 2, 3]) edible.nutrition[slot] = 100;
	edible.class[1] = foodClass.forage;
	edible.class[2] = foodClass.forage;
	edible.class[3] = foodClass.meat;
	satiety.value[0] = hungerConfig.max - 50;
	const run = eat as ActionFn<"entity">;
	const nothing = { count: 0 } as unknown as Perception;

	expect(run(ctx, 0 as Slot, 2 as EntityId, nothing)).toBe(ALTERNATE);
	expect(steps).toEqual([1]);
	expect(run(ctx, 0 as Slot, 4 as EntityId, nothing)).toBe(FAIL);
	expect(run(ctx, 0 as Slot, 1 as EntityId, nothing)).toBe(FAIL);
	expect(killed).toEqual([]);
	expect(run(ctx, 0 as Slot, 3 as EntityId, nothing)).toBe(
		hungerConfig.eatCost,
	);
	expect(killed).toEqual([3]);
	expect(satiety.value[0]).toBe(hungerConfig.max);
});

test("the game runs without hunger", () => {
	const { world, rats } = populatedWorld(
		1,
		modules.filter((m) => m !== hunger),
	);
	world.runRounds(1000);
	expect(rats.every((id) => world.alive(id))).toBe(true);
});

test("a hungry rat walks around a rat standing between it and the food", () => {
	const world = createWorld({
		seed: 1,
		floors: 1,
		width: 8,
		height: 8,
		modules: [hunger, fear, flora],
		species: { mushroom: species.mushroom },
	});
	world.spawn(0, ratAt(hungerConfig.hungryBelow - 100), 0, 3);
	world.spawn(0, rat, 1, 3);
	const food = world.spawn(0, cheese, 2, 3);
	world.runRounds(2);
	expect(world.alive(food)).toBe(false);
});

test("a hungry rat skips a taken detour and takes the free one", () => {
	const world = createWorld({
		seed: 1,
		floors: 1,
		width: 8,
		height: 8,
		modules: [hunger, fear, flora],
		species: { mushroom: species.mushroom },
	});
	world.spawn(0, ratAt(hungerConfig.hungryBelow - 100), 0, 3);
	world.spawn(0, rat, 1, 3);
	world.spawn(0, rat, 1, 2);
	const food = world.spawn(0, cheese, 2, 3);
	world.runRounds(2);
	expect(world.alive(food)).toBe(false);
});

test("a hungry rat walled off from its meal idles on its cached decision", () => {
	decisions.clear();
	const far = 4;
	const statue = { actor: true, components: {} };
	const world = createWorld({
		seed: 1,
		floors: far + 1,
		width: 4,
		height: 2,
		modules: [hunger, decider],
	});
	world.spawnPlayer(0, statue, 0, 0);
	const id = world.spawn(far, ratAt(hungerConfig.hungryBelow - 200), 0, 0);
	world.spawn(far, statue, 1, 0);
	world.spawn(far, statue, 1, 1);
	const food = world.spawn(far, cheese, 2, 0);
	idleRounds(world, LOD_PERIODS[far] ?? 0);
	expect(decisions.get(id)).toBeLessThanOrEqual(2);
	expect(world.alive(food)).toBe(true);
});
