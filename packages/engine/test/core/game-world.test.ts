import { expect, test } from "bun:test";
import type { AnyModule, EntityId } from "../../src/core/api";
import { createWorld, loadWorld, type World } from "../../src/core/world";
import { createGame } from "../../src/index";
import { game, idleRounds, populatedWorld, SIZE } from "../fixtures";

const ROUNDS = 100;
const MOSSES = 4;
const MOSS_GAP = 7;

type Row = readonly [EntityId, string, number, number];

const listing = (world: World<readonly AnyModule[]>) => {
	const rows: Row[] = [];
	world.entities(0, (id, species, x, y) => rows.push([id, species, x, y]));
	return rows;
};

const start = () => {
	const { world, rats } = populatedWorld(1, game.modules);
	const mosses = new Set<EntityId>();
	for (let i = 0; i < MOSSES; i++)
		mosses.add(world.spawn(0, "moss", SIZE - 1, i * MOSS_GAP));
	const player = world.spawnPlayer(0, "rat", SIZE / 2, SIZE / 2);
	return { world, rats, mosses, player };
};

test("entities lists every entity on the floor, with its species and cell, as rounds go by", () => {
	const { world, rats, mosses, player } = start();
	const spawned = world.eventType("core/spawned");
	const species = new Map<EntityId, string>();
	world.drainEvents(0, (type, _cause, a) => {
		if (type === spawned) species.set(a as EntityId, "cheese");
	});
	for (const id of [...rats, player]) species.set(id, "rat");
	for (const id of mosses) species.set(id, "moss");
	let regrown = 0;
	for (let round = 0; round < ROUNDS; round++) {
		idleRounds(world, 1);
		world.drainEvents(0, (type, cause, a) => {
			if (type !== spawned) return;
			expect(mosses.has(cause)).toBe(true);
			species.set(a as EntityId, "mushroom");
		});
		const rows = listing(world);
		const onFloor = [...species.keys()].filter((id) => world.alive(id));
		expect(rows.map(([id]) => id).sort((a, b) => a - b)).toEqual(
			onFloor.sort((a, b) => a - b),
		);
		for (const [id, name, x, y] of rows) {
			expect(name).toBe(species.get(id) as string);
			expect(world.locate(id)).toEqual({ floor: 0, x, y });
		}
		regrown += rows.filter(([, name]) => name === "mushroom").length;
	}
	expect(regrown).toBeGreaterThan(0);
	expect(species.get(player)).toBe("rat");
});

test("a loaded save lists the same entities", () => {
	const { world } = start();
	idleRounds(world, ROUNDS);
	expect(listing(loadWorld(world.save(), game))).toEqual(listing(world));
});

test("listing the entities every round leaves the world hash unchanged", () => {
	const listed = start().world;
	const unlisted = start().world;
	for (let round = 0; round < ROUNDS; round++) {
		idleRounds(listed, 1);
		listing(listed);
		idleRounds(unlisted, 1);
	}
	expect(listed.hash()).toBe(unlisted.hash());
});

test("a player is listed under its species", () => {
	const world = createGame({ seed: 1, floors: 1, width: 8, height: 8 });
	const player = world.spawnPlayer(0, "rat", 2, 3);
	const stoat = world.spawn(0, "stoat", 5, 5);
	const rows: Row[] = [];
	world.entities(0, (id, species, x, y) => rows.push([id, species, x, y]));
	expect(rows).toEqual([
		[player, "rat", 2, 3],
		[stoat, "stoat", 5, 5],
	]);
});

test("species stay apart in a game without fire, where cheese and mushroom share every component", () => {
	const world = createWorld({
		seed: 1,
		floors: 1,
		width: 8,
		height: 8,
		modules: game.modules.filter((m) => m.name !== "fire"),
		species: game.species,
	});
	const cheese = world.spawn(0, "cheese", 1, 1);
	const mushroom = world.spawn(0, "mushroom", 2, 1);
	expect(listing(world)).toEqual([
		[cheese, "cheese", 1, 1],
		[mushroom, "mushroom", 2, 1],
	]);
});

test("an entity spawned from a shape outside the species table has no species name", () => {
	const { world } = populatedWorld(1, game.modules, 1);
	world.spawn(0, { actor: false, components: {} }, 0, 1);
	expect(() => listing(world)).toThrow("has no species name");
});
