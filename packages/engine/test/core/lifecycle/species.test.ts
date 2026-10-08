import { expect, test } from "bun:test";
import { species } from "../../../src/content/species";
import { defineModule } from "../../../src/core/module/api";
import { createWorld, loadWorld } from "../../../src/core/world/world";
import { modules } from "../../../src/registry";

const world = (table: Readonly<Record<string, unknown>>) =>
	createWorld({
		seed: 1,
		floors: 1,
		width: 4,
		height: 4,
		modules,
		species: table as typeof species,
	});

test("a module naming a species the world lacks throws at creation", () => {
	const { mushroom: _, ...without } = species;
	expect(() => world(without)).toThrow(/flora spawns mushroom/);
});

test("the world copies registered species; the caller's objects stay unfrozen and inert", () => {
	const edible = { nutrition: 5 };
	const yields = { actor: false, components: { edible } };
	const w = world({
		...species,
		mushroom: yields,
		moss: { actor: false, components: { sprout: { period: 1, left: 1 } } },
	});
	expect([yields, yields.components, edible].some(Object.isFrozen)).toBe(false);
	edible.nutrition = 6;
	w.spawn(
		0,
		{ actor: false, components: { sprout: { period: 1, left: 1 } } },
		0,
		0,
	);
	const spawned = w.eventType("core/spawned");
	w.drainEvents(0, () => {});
	w.runRounds(1);
	const children: number[] = [];
	w.drainEvents(0, (type, _cause, a) => {
		if (type === spawned) children.push(a);
	});
	expect(children.length).toBe(1);
	expect(w.peek("edible", "nutrition", children[0] as never)).toBe(5);
});

test("a directly spawned species is read fresh on every spawn", () => {
	const w = world(species);
	const loose = { actor: false, components: { edible: { nutrition: 5 } } };
	w.spawn(0, loose, 0, 0);
	loose.components.edible.nutrition = 77;
	const second = w.spawn(0, loose, 1, 0);
	expect(w.peek("edible", "nutrition", second)).toBe(77);
});

test("a name outside the world's species table throws, inherited keys included", () => {
	const w = world(species);
	expect(() => w.spawn(0, "toString", 0, 0)).toThrow(/no species toString/);
	expect(() => w.spawnPlayer(0, "dragon", 0, 0)).toThrow(/no species dragon/);
});

test("a name spawns the species as the world copied it, whatever the caller edits later", () => {
	const edible = { nutrition: 5 };
	const table: Record<string, unknown> = {
		...species,
		mushroom: { actor: false, components: { edible } },
	};
	const w = world(table);
	edible.nutrition = 6;
	table.cheese = { actor: false, components: { edible: { nutrition: 7 } } };
	const mushroom = w.spawn(0, "mushroom", 0, 0);
	const cheese = w.spawn(0, "cheese", 1, 0);
	expect(w.peek("edible", "nutrition", mushroom)).toBe(5);
	expect(w.peek("edible", "nutrition", cheese)).toBe(
		species.cheese.components.edible.nutrition,
	);
});

test("two species names for one shape object throw at creation, naming both", () => {
	expect(() => world({ ...species, alias: species.cheese })).toThrow(
		"species alias and cheese are the same object",
	);
});

test("a shape is read once per spawn, so its checks and its writes agree", () => {
	const w = createWorld({
		seed: 1,
		floors: 2,
		width: 4,
		height: 4,
		modules,
		species,
	});
	let vitalityReads = 0;
	const flipping = {
		actor: true,
		components: {
			...species.rat.components,
			get vitality() {
				vitalityReads++;
				return vitalityReads === 1 ? { hp: 5, max: 5 } : { hp: 9, max: 5 };
			},
		},
	};
	let linkReads = 0;
	const stairs = {
		actor: false,
		components: {
			get link() {
				linkReads++;
				return { floor: linkReads === 1 ? 1 : 7, x: 1, y: 1 };
			},
		},
	};
	const rat = w.spawn(0, flipping, 0, 0);
	const way = w.spawn(0, stairs, 1, 0);
	expect(w.peek("vitality", "hp", rat)).toBe(5);
	expect(w.peek("link", "floor", way)).toBe(1);
	expect(() => loadWorld(w.save(), { modules, species })).not.toThrow();
});

test("a module's species errors name the module", () => {
	const breeder = defineModule({
		name: "breeder",
		schema: { mark: { n: "u8" } },
		config: {},
		setup(b) {
			b.species({ actor: false, components: { mark: { n: 300 } } });
		},
	});
	expect(() =>
		createWorld({
			seed: 1,
			floors: 1,
			width: 4,
			height: 4,
			modules: [breeder],
		}),
	).toThrow(/breeder species: mark.n/);
});

test("a failed load leaves the caller's species and config untouched", () => {
	const config = { yields: "mushroom" };
	const yields = { actor: false, components: { edible: { nutrition: 5 } } };
	const custom = modules.map((m) =>
		m.name === "flora" ? { ...m, config } : m,
	);
	const table = { ...species, mushroom: yields };
	const bytes = createWorld({
		seed: 1,
		floors: 1,
		width: 4,
		height: 4,
		modules: custom,
		species: table,
	}).save();
	bytes[bytes.length - 1] = (bytes[bytes.length - 1] ?? 0) ^ 1;
	expect(() => loadWorld(bytes, { modules: custom, species: table })).toThrow();
	expect([config, yields, yields.components].some(Object.isFrozen)).toBe(false);
});

test("config and species values must be plain integer data", () => {
	const bad: [string, unknown][] = [
		["a fraction", 1.5],
		["NaN", Number.NaN],
		["Infinity", Number.POSITIVE_INFINITY],
		["a function", () => 1],
		["undefined", undefined],
		["a boolean", true],
		["a date", new Date(0)],
	];
	for (const [name, value] of bad) {
		const odd = defineModule({
			name: "odd",
			schema: {},
			config: { value },
			setup() {},
		});
		expect(
			() =>
				createWorld({
					seed: 1,
					floors: 1,
					width: 4,
					height: 4,
					modules: [odd],
				}),
			name,
		).toThrow(/odd/);
	}
	const fine = defineModule({
		name: "fine",
		schema: {},
		config: { n: -3, s: "x", list: [1, { k: 2 }] },
		setup() {},
	});
	expect(() =>
		createWorld({ seed: 1, floors: 1, width: 4, height: 4, modules: [fine] }),
	).not.toThrow();
	expect(() =>
		world({ ...species, rat: { actor: "yes", components: {} } }),
	).toThrow(/species rat.actor/);
	expect(() =>
		world({
			...species,
			rat: { actor: true, components: { satiety: { value: 0.5 } } },
		}),
	).toThrow(/not an integer/);
});

test("the fingerprint ignores key order", () => {
	const a = defineModule({
		name: "a",
		schema: {},
		config: { x: 1, y: 2 },
		setup() {},
	});
	const b = defineModule({
		name: "a",
		schema: {},
		config: { y: 2, x: 1 },
		setup() {},
	});
	const bytes = createWorld({
		seed: 1,
		floors: 1,
		width: 4,
		height: 4,
		modules: [a],
	}).save();
	expect(() => loadWorld(bytes, { modules: [b] })).not.toThrow();
});
