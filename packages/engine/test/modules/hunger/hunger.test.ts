import { expect, test } from "bun:test";
import { cheese } from "../../../src/content/species/cheese";
import { rat } from "../../../src/content/species/rat";
import {
	type ActionCtx,
	type ActionFn,
	type Builder,
	type EntityId,
	FAIL,
	NONE,
	type Slot,
} from "../../../src/core/api";
import { PERCEPTION_RADIUS } from "../../../src/core/config";
import { createWorld } from "../../../src/core/world";
import { hunger } from "../../../src/modules/hunger";
import { hungerConfig } from "../../../src/modules/hunger/config";
import { modules } from "../../../src/registry";
import { game, populatedWorld } from "../../fixtures";

const smallWorld = () =>
	createWorld({ seed: 1, floors: 1, width: 16, height: 16, ...game });
const ratAt = (satiety: number) => ({
	...rat,
	components: { satiety: { value: satiety } },
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

test("eat fails on food two cells away; next to it, it fills up to max", () => {
	const satiety = { value: new Int32Array(3) };
	const edible = { nutrition: new Int16Array(3) };
	let eat: ActionFn<"entity"> | undefined;
	const builder = {
		write: (name: string) => (name === "satiety" ? satiety : edible),
		query: () => ({ has: () => true }),
		tick() {},
		propose() {},
		event: () => ({ index: 0 }),
		action: (_name: string, _kind: string, run: ActionFn<"entity">) => {
			eat = run;
			return { index: 0 };
		},
	} as unknown as Builder<typeof hunger.schema>;
	hunger.setup(builder, hungerConfig);

	const xs = [0, 2, 1];
	const killed: number[] = [];
	const ctx = {
		slotOf: (id: number) => (id >= 1 && id <= 3 ? id - 1 : NONE),
		idOf: (slot: number) => slot + 1,
		x: (slot: number) => xs[slot] ?? 0,
		y: () => 0,
		kill: (id: number) => killed.push(id),
		emit() {},
	} as unknown as ActionCtx;
	edible.nutrition[1] = 100;
	edible.nutrition[2] = 100;
	satiety.value[0] = hungerConfig.max - 50;
	const run = eat as ActionFn<"entity">;

	expect(run(ctx, 0 as Slot, 2 as EntityId)).toBe(FAIL);
	expect(killed).toEqual([]);
	expect(run(ctx, 0 as Slot, 3 as EntityId)).toBe(hungerConfig.eatCost);
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
