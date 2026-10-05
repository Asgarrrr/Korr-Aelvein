import { expect, test } from "bun:test";
import { species } from "../../../src/content/species";
import { moss } from "../../../src/content/species/moss";
import { mushroom } from "../../../src/content/species/mushroom";
import { rat } from "../../../src/content/species/rat";
import type { AnyModule, EntityId } from "../../../src/core/api";
import { createWorld, type World } from "../../../src/core/world";
import { flora } from "../../../src/modules/flora";
import { hunger } from "../../../src/modules/hunger";
import { hungerConfig } from "../../../src/modules/hunger/config";
import { modules } from "../../../src/registry";
import { populatedWorld, probe, reversed } from "../../fixtures";

const PERIOD = moss.components.sprout.period;

// Ids of the entities `parent` spawned since the last drain.
const offspring = (world: World<readonly AnyModule[]>, parent: EntityId) => {
	const spawned = world.eventType("core/spawned");
	const ids: EntityId[] = [];
	world.drainEvents(0, (type, cause, a) => {
		if (type === spawned && cause === parent) ids.push(a as EntityId);
	});
	return ids;
};

test("a sprout yields a mushroom on its own cell every period rounds", () => {
	const tracked = {
		...mushroom,
		components: { ...mushroom.components, where: {} },
	};
	const world = createWorld({
		seed: 1,
		floors: 1,
		width: 8,
		height: 8,
		modules: [hunger, flora, probe],
		species: { ...species, mushroom: tracked },
	});
	const sprout = world.spawn(0, moss, 5, 2);

	for (let cycle = 0; cycle < 2; cycle++) {
		world.runRounds(PERIOD - 1);
		expect(offspring(world, sprout)).toEqual([]);
		world.runRounds(1);
		const [child, ...rest] = offspring(world, sprout);
		expect(rest).toEqual([]);
		const id = child as EntityId;
		expect(world.peek("where", "x", id)).toBe(5);
		expect(world.peek("where", "y", id)).toBe(2);
		expect(world.peek("edible", "nutrition", id)).toBe(
			mushroom.components.edible.nutrition,
		);
	}
});

const ROUNDS = 1000;

// Every cell of a 7x7 floor is within perception of the sprout in its centre.
const roundsLived = (list: readonly AnyModule[]) => {
	const world = createWorld({
		seed: 1,
		floors: 1,
		width: 7,
		height: 7,
		modules: list,
		species,
	});
	world.spawn(0, moss, 3, 3);
	const ratId = world.spawn(0, rat, 0, 0);
	for (let round = 1; round <= ROUNDS; round++) {
		world.runRounds(1);
		if (!world.alive(ratId)) return round;
	}
	return ROUNDS + 1;
};

test("a rat beside a sprout outlives one without flora", () => {
	const starved = Math.ceil(
		rat.components.satiety.value / hungerConfig.decayPerTurn,
	);
	expect(roundsLived(modules.filter((m) => m !== flora))).toBe(starved);
	expect(roundsLived(modules)).toBe(ROUNDS + 1);
});

const SPROUTS = 12;

const hashAfter = (list: readonly AnyModule[]) => {
	const { world } = populatedWorld(1, list, 30);
	for (let i = 0; i < SPROUTS; i++)
		world.spawn(0, moss, (i * 7) % 32, (i * 11) % 32);
	world.runRounds(300);
	return world.hash();
};

test("flora spawns and starvation kills do not depend on row iteration order", () => {
	const flipped = modules.map((m): AnyModule => {
		if (m === hunger) return reversed(hunger);
		return m === flora ? reversed(flora) : m;
	});
	expect(hashAfter(flipped)).toBe(hashAfter(modules));
});

test("the game runs without flora", () => {
	const { world } = populatedWorld(
		1,
		modules.filter((m) => m !== flora),
	);
	for (let i = 0; i < SPROUTS; i++) world.spawn(0, moss, i, i);
	expect(() => world.runRounds(ROUNDS)).not.toThrow();
});
