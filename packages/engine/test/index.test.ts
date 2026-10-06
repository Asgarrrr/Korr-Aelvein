import { expect, test } from "bun:test";
import { Engine } from "../src/core/engine";
import { createWorld, loadWorld } from "../src/core/world/world";
import { game } from "../src/game";
import { createGame, type EntityId, loadGame, type World } from "../src/index";

const OPTIONS = { seed: 1, floors: 2, width: 12, height: 12 } as const;

const playRounds = (world: World, n: number) => {
	for (let round = 0; round < n; round++)
		for (let due = world.advance(); due.length > 0; due = world.advance())
			for (const player of due) world.input(player, "core/idle", null);
};

const start = (world = createGame(OPTIONS)) => {
	for (let i = 0; i < 4; i++) {
		world.spawn(0, "rat", i * 3, 2);
		world.spawn(1, "stoat", i * 3, 9);
		world.spawn(1, "mushroom", i * 2 + 1, 5);
	}
	const player: EntityId = world.spawnPlayer(0, "rat", 6, 8);
	return { world, player };
};

test("a game saved mid-run and loaded plays on exactly as the unbroken run", () => {
	const { world: unbroken, player } = start();
	playRounds(unbroken, 30);
	const { world: first } = start();
	playRounds(first, 12);
	const loaded = loadGame(first.save());
	expect(loaded.hash()).toBe(first.hash());
	playRounds(loaded, 18);
	expect(loaded.hash()).toBe(unbroken.hash());
	expect(loaded.inputs().length).toBeGreaterThan(0);
	expect(loaded.locate(player)).not.toBe("dead");
});

test("createGame builds the game with the options it is given", () => {
	const ended = (world: World) => {
		start(world);
		playRounds(world, 10);
		return world.hash();
	};
	const seed1 = ended(createGame(OPTIONS));
	expect(ended(createGame({ ...OPTIONS, seed: 2 }))).not.toBe(seed1);
	expect(ended(createWorld({ ...OPTIONS, ...game }))).toBe(seed1);
});

test("a load takes the world from the save: option keys other than check cannot override it", () => {
	const { world: source } = start();
	playRounds(source, 6);
	const bytes = source.save();
	const options = { check: "full" as const, seed: 99, floors: 1, popCap: 5 };
	const loads = [
		loadGame(bytes, options),
		loadWorld(bytes, { ...game, ...options }),
	];
	playRounds(source, 6);
	for (const loaded of loads) {
		playRounds(loaded, 6);
		expect(loaded.hash()).toBe(source.hash());
	}
});

test("no property of a World, own or inherited, reaches the engine", () => {
	const { world } = start();
	const reached: unknown[] = [];
	for (
		let at: object | null = world;
		at !== null && at !== Object.prototype;
		at = Object.getPrototypeOf(at)
	)
		for (const key of Reflect.ownKeys(at))
			reached.push(Reflect.get(at, key, world));
	expect(reached.length).toBeGreaterThan(0);
	expect(reached.some((value) => value instanceof Engine)).toBe(false);
});
