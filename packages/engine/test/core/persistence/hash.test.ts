import { expect, test } from "bun:test";
import { cheese } from "../../../src/content/species/cheese";
import { createWorld } from "../../../src/core/world/world";
import { modules } from "../../../src/registry";
import { game, populatedWorld } from "../../fixtures";

const hashAfter = (seed: number) => {
	const { world } = populatedWorld(seed, modules);
	world.runRounds(200);
	return world.hash();
};
const seed1 = hashAfter(1);

test("the same seed gives the same hash", () => {
	expect(hashAfter(1)).toBe(seed1);
});

test("a different seed gives a different hash", () => {
	expect(hashAfter(2)).not.toBe(seed1);
});

test("the seed 1 world hash is pinned", () => {
	// Regression lock: any change to simulation order, RNG or storage layout shows up here.
	expect(seed1).toBe("194a08d45c8c9728");
});

const twoFloors = (seed: number, popCap?: number) =>
	createWorld({
		seed,
		floors: 2,
		width: 8,
		height: 8,
		...game,
		...(popCap === undefined ? {} : { popCap }),
	});

test("the hash covers the world shape and every floor", () => {
	const base = twoFloors(1).hash();
	expect(twoFloors(2).hash()).not.toBe(base);
	expect(twoFloors(1, 50).hash()).not.toBe(base);
	const busy = twoFloors(1);
	busy.spawn(1, cheese, 3, 3);
	expect(busy.hash()).not.toBe(base);
});
