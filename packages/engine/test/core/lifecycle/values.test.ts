import { expect, test } from "bun:test";
import { species } from "../../../src/content/species";
import { createWorld, loadWorld } from "../../../src/core/world/world";
import { modules } from "../../../src/registry";
import { unnamed } from "../../fixtures";

const world = () =>
	createWorld({ seed: 1, floors: 1, width: 4, height: 4, modules, species });

const twoFloors = () =>
	createWorld({ seed: 1, floors: 2, width: 4, height: 4, modules, species });

test("a spawn by name with values builds the same world as a shape holding those values, but for its species index", () => {
	const { rat, stairs } = species;
	const byName = twoFloors();
	byName.spawnPlayer(0, "rat", 0, 0, {
		satiety: { value: 300 },
		vitality: { hp: 4 },
	});
	byName.spawn(0, "stairs", 1, 0, { link: { floor: 1, x: 2, y: 3 } });
	const byShape = twoFloors();
	byShape.spawnPlayer(
		0,
		{
			...rat,
			components: {
				...rat.components,
				satiety: { value: 300 },
				vitality: { hp: 4, max: 10 },
			},
		},
		0,
		0,
	);
	byShape.spawn(
		0,
		{ ...stairs, components: { link: { floor: 1, x: 2, y: 3 } } },
		1,
		0,
	);
	expect(unnamed(byName.save())).toEqual(byShape.save());
});

test("values hold for their spawn only", () => {
	const w = world();
	const hungry = w.spawn(0, "rat", 0, 0, { satiety: { value: 300 } });
	const next = w.spawn(0, "rat", 1, 0);
	expect(w.peek("satiety", "value", hungry)).toBe(300);
	expect(w.peek("satiety", "value", next)).toBe(
		species.rat.components.satiety.value,
	);
});

test("values a save could not hold throw, and the world stays as it was", () => {
	const w = twoFloors();
	const before = w.save();
	const bad: [string, object, RegExp][] = [
		["a component the species lacks", { satiety: { value: 1 } }, /satiety/],
		["a field the component lacks", { edible: { taste: 1 } }, /taste/],
		["a fraction", { edible: { nutrition: 1.5 } }, /not an integer/],
		["a missing value", { edible: { nutrition: undefined } }, /not an integer/],
		["above the kind", { edible: { class: 256 } }, /class/],
		["below the kind", { edible: { class: -1 } }, /class/],
		["above i16", { edible: { nutrition: 0x8000 } }, /nutrition/],
	];
	for (const [name, values, message] of bad)
		expect(() => w.spawn(0, "cheese", 0, 0, values as never), name).toThrow(
			message,
		);
	const deadly: [string, object, RegExp][] = [
		["hp above max", { vitality: { hp: 11 } }, /vitality/],
		["no hp", { vitality: { hp: 0 } }, /vitality/],
		["max below hp", { vitality: { max: 9 } }, /vitality/],
	];
	for (const [name, values, message] of deadly)
		expect(() => w.spawn(0, "rat", 0, 0, values as never), name).toThrow(
			message,
		);
	const nowhere: [string, object][] = [
		["its own floor", { link: { floor: 0, x: 1, y: 1 } }],
		["no such floor", { link: { floor: 2, x: 1, y: 1 } }],
		["off the floor", { link: { floor: 1, x: 4, y: 1 } }],
		["the placeholder", {}],
	];
	for (const [name, values] of nowhere)
		expect(() => w.spawn(0, "stairs", 0, 0, values as never), name).toThrow(
			/leads nowhere/,
		);
	expect(w.save()).toEqual(before);
});

test("inherited field names are no fields, in values and in shapes", () => {
	const w = world();
	const before = w.save();
	const proto = /__proto__ is not a component or field name/;
	for (const [fields, message] of [
		[JSON.parse('{"__proto__":1}'), proto],
		[{ constructor: 1 }, /has no field/],
	] as const) {
		expect(() => w.spawn(0, "cheese", 0, 0, { edible: fields })).toThrow(
			message,
		);
		const shape = { actor: false, components: { edible: fields } };
		expect(() => w.spawn(0, shape, 0, 0)).toThrow(message);
	}
	const components = JSON.parse('{"__proto__":{"edible":{"nutrition":5}}}');
	expect(() => w.spawn(0, "cheese", 0, 0, components)).toThrow(proto);
	expect(() => w.spawn(0, { actor: false, components }, 0, 0)).toThrow(proto);
	expect(Object.keys(Object.prototype)).toEqual([]);
	expect(Object.hasOwn(Object, 0)).toBe(false);
	expect(w.save()).toEqual(before);
});

test("a spawn started while another reads its values throws, and the world stays as it was", () => {
	const w = world();
	const before = w.save();
	const values = {
		get edible() {
			w.spawn(0, "cheese", 1, 1);
			return { nutrition: 1 };
		},
	};
	expect(() => w.spawn(0, "cheese", 0, 0, values)).toThrow(/spawn is reading/);
	expect(w.save()).toEqual(before);
	expect(() => w.spawn(0, "cheese", 0, 0)).not.toThrow();
});

test("a getter cannot change the world while a spawn reads it", () => {
	const w = world();
	const before = w.save();
	const values = {
		get edible() {
			w.runRounds(3);
			return { nutrition: 1 };
		},
	};
	expect(() => w.spawn(0, "cheese", 0, 0, values)).toThrow(/spawn is reading/);
	const shape = {
		actor: true,
		get components() {
			w.advance();
			return species.rat.components;
		},
	};
	expect(() => w.spawnPlayer(0, shape, 0, 0)).toThrow(/spawn is reading/);
	expect(w.save()).toEqual(before);
	expect(() => loadWorld(w.save(), { modules, species })).not.toThrow();
	expect(() => w.spawn(0, "cheese", 0, 0)).not.toThrow();
});

test("values for a component no registered module owns are ignored, as a shape's are", () => {
	const withoutHunger = modules.filter((m) => m.name !== "hunger");
	const bare = () =>
		createWorld({
			seed: 1,
			floors: 1,
			width: 4,
			height: 4,
			modules: withoutHunger,
			species,
		});
	const valued = bare();
	valued.spawn(0, "rat", 0, 0, { satiety: { value: 5 } });
	const plain = bare();
	plain.spawn(0, "rat", 0, 0);
	expect(valued.save()).toEqual(plain.save());
});

test("values reach the edges of their kind and no further", () => {
	const edges: [string, string, string, number, number][] = [
		["moss", "sprout", "period", 65535, 65536],
		["rat", "satiety", "value", 2 ** 31 - 1, 2 ** 31],
		["cheese", "edible", "nutrition", -32768, -32769],
	];
	for (const [name, component, field, edge, beyond] of edges) {
		const w = world();
		const id = w.spawn(0, name, 0, 0, { [component]: { [field]: edge } });
		expect(w.peek(component as never, field as never, id), name).toBe(edge);
		expect(
			() => w.spawn(0, name, 1, 0, { [component]: { [field]: beyond } }),
			name,
		).toThrow(new RegExp(`species ${name}: ${component}.${field}`));
	}
});
