import { expect, test } from "bun:test";
import {
	createStarterGame,
	type EntityId,
	type SpeciesName,
	starter,
	type World,
} from "../../src/index";

// At 50 rounds no rat is hungry yet and every cheese is still there.
const ROUNDS = 200;

const listed = (world: World, skip?: EntityId) => {
	const found: { species: SpeciesName; x: number; y: number }[] = [];
	world.entities(0, (id, species, x, y) => {
		if (id !== skip) found.push({ species, x, y });
	});
	return found;
};

const cell = ({ x, y }: { x: number; y: number }) => y * starter.width + x;

const byCell = (a: { x: number; y: number }, b: { x: number; y: number }) =>
	cell(a) - cell(b);

test("createStarterGame places exactly the layout on floor 0", () => {
	const world = createStarterGame(1);
	expect(listed(world).sort(byCell)).toEqual([...starter.layout].sort(byCell));
});

test("the layout fits the floor, one entity per cell, the start cell free", () => {
	const occupied = new Set<number>();
	for (const entry of starter.layout) {
		expect(entry.x).toBeGreaterThanOrEqual(0);
		expect(entry.x).toBeLessThan(starter.width);
		expect(entry.y).toBeGreaterThanOrEqual(0);
		expect(entry.y).toBeLessThan(starter.height);
		occupied.add(cell(entry));
	}
	expect(occupied.size).toBe(starter.layout.length);
	expect(occupied.has(cell(starter.start))).toBe(false);
});

test("the starter cannot be changed for later games", () => {
	const loose = starter as unknown as {
		width: number;
		start: { x: number };
		layout: { x: number }[];
	};
	expect(() => {
		loose.width = 1;
	}).toThrow(TypeError);
	expect(() => {
		loose.start.x = 0;
	}).toThrow(TypeError);
	expect(() => loose.layout.push({ x: 0 })).toThrow(TypeError);
	expect(() => {
		const [first] = loose.layout;
		if (first) first.x = 0;
	}).toThrow(TypeError);
	expect(listed(createStarterGame(1)).sort(byCell)).toEqual(
		[...starter.layout].sort(byCell),
	);
});

// Moss regrows mushrooms, so total food can rise.
// Cheese never regrows: it leaves only when eaten.
test("creatures eat on the starter floor and rats survive", () => {
	const world = createStarterGame(7);
	const player = world.spawnPlayer(0, "rat", starter.start.x, starter.start.y);
	const count = (species: SpeciesName) =>
		listed(world, player).filter((e) => e.species === species).length;
	const cheese = count("cheese");
	for (let round = 0; round < ROUNDS; round++)
		for (let due = world.advance(); due.length > 0; due = world.advance())
			for (const id of due) world.input(id, "core/idle", null);
	expect(count("cheese")).toBeLessThan(cheese);
	expect(count("rat")).toBeGreaterThan(0);
});
