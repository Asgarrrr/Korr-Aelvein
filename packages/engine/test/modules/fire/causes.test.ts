import { expect, test } from "bun:test";
import { ember } from "../../../src/content/species/ember";
import { moss } from "../../../src/content/species/moss";
import { mushroom } from "../../../src/content/species/mushroom";
import type { AnyModule, EntityId } from "../../../src/core/module/api";
import { createWorld, type World } from "../../../src/core/world/world";
import { fire } from "../../../src/modules/fire";
import { fireConfig } from "../../../src/modules/fire/config";
import { WATCHER, watch } from "./watch";

const sure = { ...fire, config: { ...fireConfig, spreadChance: 100 } };

const deaths = (world: World<readonly AnyModule[]>) => {
	const died = world.eventType("core/died");
	const out: [number, number, number][] = [];
	world.drainEvents(0, (type, cause, a, _b, time) => {
		if (type === died) out.push([a, cause, time / 100]);
	});
	return out;
};

const worldOf = (width: number, height: number) =>
	createWorld({ seed: 1, floors: 1, width, height, modules: [sure, watch] });

test("each cell's fire and cause over rounds, with an ember added mid-fire", () => {
	const world = worldOf(3, 3);
	const names = new Map<number, string>([[0, "-"]]);
	const at = (name: string, id: EntityId) => {
		names.set(id, name);
		return id;
	};
	at("E1", world.spawn(0, ember, 0, 0));
	at("E2", world.spawn(0, ember, 0, 2));
	at("M", world.spawn(0, moss, 1, 1));
	at("P", world.spawn(0, moss, 2, 1));
	at("Q", world.spawn(0, mushroom, 2, 1));
	const body = { actor: true, components: { vitality: { hp: 4, max: 4 } } };
	at("R", world.spawn(0, body, 2, 1));
	const middle = world.spawn(0, WATCHER, 1, 1);
	const right = world.spawn(0, WATCHER, 2, 1);
	world.drainEvents(0, () => {});
	const name = (id: number) => names.get(id) ?? String(id);
	const table: (string | number)[][] = [];
	const died: string[][] = [];
	for (let round = 0; round < 6; round++) {
		if (round === 2) at("E3", world.spawn(0, ember, 1, 1));
		world.runRounds(1);
		table.push(
			[middle, right].flatMap((id) => [
				world.peek("feel", "left", id),
				name(world.peek("feel", "source", id)),
			]),
		);
		for (const [id, cause, when] of deaths(world))
			died.push([name(id), name(cause), String(when)]);
	}
	expect(table).toEqual([
		[0, "-", 0, "-"],
		[3, "M", 0, "-"],
		[2, "E3", 3, "P"],
		[2, "E3", 2, "P"],
		[2, "E3", 1, "P"],
		[2, "E3", 0, "-"],
	]);
	expect(died).toEqual([
		["M", "E1", "1"],
		["R", "P", "2"],
		["P", "M", "2"],
		["Q", "M", "2"],
	]);
});

test("a flammable creature beside an ember is consumed, never burned: the ember is the cause", () => {
	const world = worldOf(4, 1);
	const source = world.spawn(0, ember, 0, 0);
	const torch = world.spawn(
		0,
		{
			actor: true,
			components: { vitality: { hp: 1, max: 1 }, flammable: { burn: 3 } },
		},
		1,
		0,
	);
	world.drainEvents(0, () => {});
	world.runRounds(3);
	expect(deaths(world)).toEqual([[torch, source, 1]]);
});

test("a row that ignites is never fuel, even when flammable", () => {
	const world = worldOf(4, 1);
	const lamp = world.spawn(
		0,
		{ actor: false, components: { ignites: {}, flammable: { burn: 3 } } },
		1,
		0,
	);
	const seen = world.spawn(0, WATCHER, 1, 0);
	world.runRounds(5);
	expect(world.alive(lamp)).toBe(true);
	expect(world.peek("feel", "source", seen)).toBe(lamp);
});

test("fuel that burns 0 turns is consumed without lighting its cell", () => {
	const world = worldOf(4, 1);
	const source = world.spawn(0, ember, 0, 0);
	const dry = world.spawn(
		0,
		{ actor: false, components: { flammable: { burn: 0 } } },
		1,
		0,
	);
	const beyond = world.spawn(0, moss, 2, 0);
	const seen = world.spawn(0, WATCHER, 1, 0);
	world.drainEvents(0, () => {});
	const fire: number[][] = [];
	for (let round = 0; round < 4; round++) {
		world.runRounds(1);
		fire.push([
			world.peek("feel", "left", seen),
			world.peek("feel", "source", seen),
		]);
	}
	expect(fire).toEqual([
		[0, 0],
		[0, 0],
		[0, 0],
		[0, 0],
	]);
	expect(deaths(world)).toEqual([[dry, source, 1]]);
	expect(world.alive(beyond)).toBe(true);
});

test("fuel on a cell's last burning turn is consumed and does not relight it", () => {
	const world = worldOf(4, 1);
	world.spawn(0, ember, 0, 0);
	const first = world.spawn(0, moss, 1, 0);
	const seen = world.spawn(0, WATCHER, 1, 0);
	world.runRounds(4);
	expect(world.peek("feel", "left", seen)).toBe(1);
	const late = world.spawn(0, moss, 1, 0);
	world.drainEvents(0, () => {});
	world.runRounds(1);
	expect([
		world.peek("feel", "left", seen),
		world.peek("feel", "source", seen),
	]).toEqual([0, 0]);
	expect(deaths(world)).toEqual([[late, first, 4]]);
});

test("a flammable row that ignites, spawned beside fire, is not consumed by the spread", () => {
	const world = worldOf(4, 1);
	world.spawn(0, ember, 0, 0);
	world.runRounds(1);
	const lamp = world.spawn(
		0,
		{ actor: false, components: { ignites: {}, flammable: { burn: 3 } } },
		1,
		0,
	);
	world.runRounds(3);
	expect(world.alive(lamp)).toBe(true);
});
