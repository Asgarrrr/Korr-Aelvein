import { expect, test } from "bun:test";
import { cheese } from "../../../src/content/species/cheese";
import { moss } from "../../../src/content/species/moss";
import { rat } from "../../../src/content/species/rat";
import { createWorld } from "../../../src/core/world";
import { exploreConfig } from "../../../src/modules/explore/config";
import { game } from "../../fixtures";

const FLOORS = 4;
const SIDE = 12;
const ROUNDS = 80;
const hungry = {
	...rat,
	components: {
		...rat.components,
		satiety: { value: exploreConfig.restlessBelow - 50 },
	},
};
const stairsTo = (floor: number, x: number, y: number) => ({
	actor: false,
	components: { link: { floor, x, y } },
});

// Stairs both ways between neighbouring floors; only the last floor has food.
const tower = (seed: number, floorOrder?: readonly number[]) => {
	const world = createWorld({
		seed,
		floors: FLOORS,
		width: SIDE,
		height: SIDE,
		...game,
		...(floorOrder ? { floorOrder } : {}),
	});
	for (let f = 0; f < FLOORS; f++) {
		if (f + 1 < FLOORS) world.spawn(f, stairsTo(f + 1, 2, 9), 9, 2);
		if (f > 0) world.spawn(f, stairsTo(f - 1, 9, 2), 2, 9);
		for (let i = 0; i < 8; i++)
			world.spawn(f, hungry, (i * 5 + seed) % SIDE, (i * 3 + f) % SIDE);
		world.spawn(f, moss, (seed * 7 + f) % SIDE, 5);
	}
	for (let i = 0; i < 20; i++)
		world.spawn(FLOORS - 1, cheese, (i * 7) % SIDE, (i * 5) % SIDE);
	return world;
};

const departures = (world: ReturnType<typeof tower>) => {
	const departed = world.eventType("core/departed");
	let n = 0;
	for (let f = 0; f < FLOORS; f++)
		world.drainEvents(f, (type) => {
			if (type === departed) n++;
		});
	return n;
};

for (const seed of [1, 2, 3])
	test(`floor order inside a round never changes the hash (seed ${seed})`, () => {
		const straight = tower(seed);
		straight.runRounds(ROUNDS);
		expect(departures(straight)).toBeGreaterThan(4);
		for (const order of [
			[3, 2, 1, 0],
			[2, 0, 3, 1],
			[1, 3, 0, 2],
		]) {
			const permuted = tower(seed, order);
			permuted.runRounds(ROUNDS);
			expect(permuted.hash()).toBe(straight.hash());
		}
	});

test("a floor order that is not a permutation throws", () => {
	expect(() => tower(1, [0, 1, 1, 3])).toThrow(/permutation/);
	expect(() => tower(1, [0, 1, 2])).toThrow(/permutation/);
});
