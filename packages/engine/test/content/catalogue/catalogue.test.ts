import { expect, test } from "bun:test";
import { catalogue } from "../../../src/content/catalogue";
import { species as fixed } from "../../../src/content/species";
import { loadWorld } from "../../../src/core/world/world";
import { createGame, loadGame } from "../../../src/game";
import { modules } from "../../../src/registry";

const SEEDS = Array.from({ length: 64 }, (_, i) => i + 1);
const FIRST_TIER_FROM = 24;

const vitalityOf = (seed: number, name = "herbivore.0") => {
	const vitality = catalogue(seed).species[name]?.components.vitality;
	return { hp: vitality?.hp, max: vitality?.max };
};

test("one seed gives one catalogue: the fixed species plus herbivore.0", () => {
	for (const seed of SEEDS.slice(0, 8)) {
		const built = catalogue(seed);
		expect(built).toEqual(catalogue(seed));
		expect(Object.keys(built.species).sort()).toEqual(
			[...Object.keys(fixed), "herbivore.0"].sort(),
		);
	}
});

test("herbivore.0 size varies with the seed: hp equals max, both within 6..40", () => {
	const maxima = new Set<unknown>();
	for (const seed of SEEDS) {
		const { hp, max } = vitalityOf(seed);
		expect(hp).toBe(max);
		expect(max).toBeGreaterThanOrEqual(6);
		expect(max).toBeLessThanOrEqual(40);
		maxima.add(max);
	}
	expect(maxima.size).toBeGreaterThanOrEqual(2);
});

test("a look names the stem and the size tier of each species", () => {
	const tiers = new Set<number>();
	for (const seed of SEEDS) {
		const { species, looks } = catalogue(seed);
		expect(Object.keys(looks).sort()).toEqual(Object.keys(species).sort());
		for (const name of Object.keys(fixed)) expect(looks[name]?.stem).toBe(name);
		const look = looks["herbivore.0"];
		expect(look?.stem).toBe("rat");
		const max = vitalityOf(seed).max as number;
		expect(look?.tier).toBe(max < FIRST_TIER_FROM ? 0 : 1);
		tiers.add(look?.tier ?? -1);
	}
	expect([...tiers].sort()).toEqual([0, 1]);
});

test("a seed outside u32 is refused", () => {
	expect(() => catalogue(2 ** 32)).toThrow(/not a u32/);
});

const OPTIONS = { seed: 5, floors: 1, width: 12, height: 12 } as const;

const started = () => {
	const world = createGame(OPTIONS);
	for (let i = 0; i < 4; i++) {
		world.spawn(0, "herbivore.0", i * 3, 2);
		world.spawn(0, "cheese", i * 3 + 1, 8);
	}
	return world;
};

test("a game with herbivore.0 saved and loaded plays on exactly as the unbroken run", () => {
	const unbroken = started();
	unbroken.runRounds(20);
	const first = started();
	first.runRounds(10);
	const loaded = loadGame(first.save());
	expect(loaded.hash()).toBe(first.hash());
	loaded.runRounds(10);
	expect(loaded.hash()).toBe(unbroken.hash());
});

test("a save loaded with another seed's catalogue is refused by the fingerprint", () => {
	expect(vitalityOf(6)).not.toEqual(vitalityOf(5));
	const bytes = started().save();
	expect(() =>
		loadWorld(bytes, { modules, species: catalogue(5).species }),
	).not.toThrow();
	expect(() =>
		loadWorld(bytes, { modules, species: catalogue(6).species }),
	).toThrow(/fingerprint/);
});

test("a write through one catalogue never reaches the next", () => {
	const before = catalogue(2).species.rat?.components.vitality?.max;
	const vitality = catalogue(1).species.rat?.components.vitality;
	expect(vitality && Reflect.set(vitality, "max", 99)).toBe(false);
	expect(catalogue(2).species.rat?.components.vitality?.max).toBe(before);
});
