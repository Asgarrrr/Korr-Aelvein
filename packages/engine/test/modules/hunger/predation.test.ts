import { expect, test } from "bun:test";
import { cheese } from "../../../src/content/species/cheese";
import { rat } from "../../../src/content/species/rat";
import { stoat } from "../../../src/content/species/stoat";
import type { EntityId } from "../../../src/core/module/api";
import { createWorld } from "../../../src/core/world/world";
import { hungerConfig } from "../../../src/modules/hunger/config";
import { game } from "../../fixtures";

const HUNGRY = hungerConfig.hungryBelow - 100;
const hungryRat = {
	...rat,
	components: { ...rat.components, satiety: { value: HUNGRY } },
};
const hungryStoat = {
	...stoat,
	components: { ...stoat.components, satiety: { value: HUNGRY } },
};

const smallWorld = () =>
	createWorld({
		seed: 1,
		floors: 1,
		width: 16,
		height: 16,
		...game,
	});

test("a hungry stoat next to a rat eats it, and the rat dies of the stoat", () => {
	const world = smallWorld();
	const hunter = world.spawn(0, hungryStoat, 5, 5);
	const prey = world.spawn(0, rat, 6, 5);
	world.runRounds(1);

	expect(world.alive(prey)).toBe(false);
	const died = world.eventType("core/died");
	let cause = 0;
	world.drainEvents(0, (type, by, a) => {
		if (type === died && a === prey) cause = by;
	});
	expect(cause).toBe(hunter);
	expect(world.peek("satiety", "value", hunter)).toBeGreaterThan(HUNGRY);
});

for (const [name, kind] of [
	["stoat", hungryStoat],
	["rat", hungryRat],
] as const)
	test(`a hungry ${name} never eats another ${name}`, () => {
		const world = smallWorld();
		const ids: EntityId[] = [];
		for (let i = 0; i < 4; i++) ids.push(world.spawn(0, kind, 6 + i, 6));
		world.runRounds(20);
		expect(ids.every((id) => world.alive(id))).toBe(true);
	});

test("a hungry rat passes over a nearer rat and walks to cheese", () => {
	const world = smallWorld();
	world.spawn(0, hungryRat, 5, 5);
	world.spawn(0, rat, 6, 5);
	const food = world.spawn(0, cheese, 5, 8);
	world.runRounds(3);
	expect(world.alive(food)).toBe(false);
});
