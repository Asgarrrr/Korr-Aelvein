import { expect, test } from "bun:test";
import { modules } from "../../src/registry";
import { populatedWorld } from "../fixtures";

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
	expect(seed1).toBe("b4de477c0bf61ba4");
});
