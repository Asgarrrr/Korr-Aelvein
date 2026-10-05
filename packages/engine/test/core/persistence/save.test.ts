import { expect, test } from "bun:test";
import { species } from "../../../src/content/species";
import { cheese } from "../../../src/content/species/cheese";
import { moss } from "../../../src/content/species/moss";
import { mushroom } from "../../../src/content/species/mushroom";
import { rat } from "../../../src/content/species/rat";
import {
	type AnyModule,
	defineModule,
	type EntityId,
	type SpeciesShape,
} from "../../../src/core/api";
import { CAP } from "../../../src/core/config";
import { createWorld, loadWorld } from "../../../src/core/world";
import { flora } from "../../../src/modules/flora";
import { hunger } from "../../../src/modules/hunger";
import { modules } from "../../../src/registry";
import { populatedWorld } from "../../fixtures";

// popCap binds once mushrooms pile up, so a restore that drops it diverges.
const POP_CAP = 120;
// Edible actors born into recycled slots put slot order out of id order.
const walker = {
	actor: true,
	components: { ...mushroom.components, satiety: { value: 400 } },
};
const walkers = { ...species, mushroom: walker };

const build = (table: Readonly<Record<string, SpeciesShape>> = species) => {
	const { world } = populatedWorld(1, modules, 50, {
		popCap: POP_CAP,
		species: table,
	});
	for (let i = 0; i < 10; i++)
		world.spawn(0, moss, (i * 7) % 32, (i * 13) % 32);
	return world;
};

for (const [yields, table] of [
	["mushrooms", species],
	["walking mushrooms", walkers],
] as const)
	test(`200 rounds, save, load, 300 rounds equals 500 in one run (${yields})`, () => {
		const straight = build(table);
		straight.runRounds(500);
		const first = build(table);
		first.runRounds(200);
		const resumed = loadWorld(first.save(), { modules, species: table });
		resumed.runRounds(300);
		expect(resumed.hash()).toBe(straight.hash());
	});

test("save, load, save gives the same bytes", () => {
	const world = build();
	world.runRounds(250);
	const bytes = world.save();
	expect(loadWorld(bytes, { modules, species }).save()).toEqual(bytes);
	expect(world.saveFloor(0).length).toBeLessThan(bytes.length);
});

test("loading with another registry, config, species table or format throws", () => {
	const bytes = build().save();
	const others: readonly AnyModule[][] = [
		modules.filter((m) => m !== flora),
		modules.map((m) =>
			m === flora
				? {
						...flora,
						schema: { sprout: { period: "u16", left: "u8" } } as const,
					}
				: m,
		),
		modules.map((m) =>
			m === hunger ? { ...hunger, config: { ...hunger.config, max: 999 } } : m,
		),
	];
	for (const list of others)
		expect(() => loadWorld(bytes, { modules: list, species })).toThrow(
			/fingerprint/,
		);
	// No module spawns cheese, so only the table itself can tell the two worlds apart.
	const richer = {
		...species,
		cheese: { ...cheese, components: { edible: { nutrition: 601 } } },
	};
	expect(() => loadWorld(bytes, { modules, species: richer })).toThrow(
		/fingerprint/,
	);
	const future = bytes.slice();
	new Int32Array(future.buffer)[0] = 99;
	expect(() => loadWorld(future, { modules, species })).toThrow(/version/);
});

test("a loaded world keeps its event switches and popCap", () => {
	const world = populatedWorld(1, modules, 3, {
		popCap: 6,
		events: false,
	}).world;
	const loaded = loadWorld(world.save(), { modules, species });
	expect(() => loaded.spawn(0, rat, 31, 31)).toThrow(/popCap/);
	loaded.runRounds(400);
	let count = 0;
	loaded.drainEvents(0, () => count++);
	expect(count).toBe(0);
});

// At this round the build world has eaten cheese and not yet refilled every slot.
const WITH_FREE_SLOTS = 130;

test("a dead slot's zeroed id does not resolve after load", () => {
	const world = build();
	world.runRounds(WITH_FREE_SLOTS);
	const loaded = loadWorld(world.save(), { modules, species });
	expect(loaded.alive(0 as EntityId)).toBe(false);
});

// One floor: world header words 0-8, event switch 9, image length 10, then the
// floor image: version 11, fingerprint 12, floor 13, counter 14, high water 15,
// free count 16, time 17, checksum 18-19, free list from 20.
const SEED_WORD = 3;
const ROUND_WORD = 4;
const FLOORS_WORD = 5;
const WIDTH_WORD = 6;
const SWITCH_WORD = 9;
const COUNTER_WORD = 14;
const HIGH_WATER_WORD = 15;
const FREE_COUNT_WORD = 16;
const TIME_WORD = 17;
const FIRST_FREE_WORD = 20;

const edited = (bytes: Uint8Array, word: number, value: number) => {
	const copy = bytes.slice();
	new Int32Array(copy.buffer)[word] = value;
	return copy;
};

test("a damaged save throws and never loads", () => {
	const world = build();
	world.runRounds(WITH_FREE_SLOTS);
	const bytes = world.save();
	const words = new Int32Array(bytes.buffer);
	expect(words[FREE_COUNT_WORD]).toBeGreaterThan(0);
	const flipped = (at: number) => {
		const copy = bytes.slice();
		copy[at] = (copy[at] ?? 0) ^ 1;
		return copy;
	};
	const cases: [string, Uint8Array, RegExp][] = [
		["empty", new Uint8Array(0), /save file/],
		["half", bytes.slice(0, bytes.length >> 1), /save file/],
		["one word short", bytes.slice(0, bytes.length - 4), /save file/],
		["odd length", bytes.slice(0, bytes.length - 1), /save file/],
		["trailing word", Uint8Array.from([...bytes, 0, 0, 0, 0]), /trailing/],
		["floors 1e8", edited(bytes, FLOORS_WORD, 1e8), /save file/],
		["negative round", edited(bytes, ROUND_WORD, -7), /save file/],
		["event switch 2", edited(bytes, SWITCH_WORD, 2), /event switch is 2/],
		[
			"high water past CAP",
			edited(bytes, HIGH_WATER_WORD, CAP + 50),
			/high water/,
		],
		[
			"high water one lower",
			edited(bytes, HIGH_WATER_WORD, POP_CAP - 1),
			/words, expected/,
		],
		["negative high water", edited(bytes, HIGH_WATER_WORD, -5), /high water/],
		["free count 500", edited(bytes, FREE_COUNT_WORD, 500), /free count 500/],
		["counter below high water", edited(bytes, COUNTER_WORD, 1), /id counter/],
		["time off its round", edited(bytes, TIME_WORD, 7), /time/],
		["width changed", edited(bytes, WIDTH_WORD, 64), /words, expected/],
		[
			"free slot changed",
			edited(bytes, FIRST_FREE_WORD, CAP),
			/checksum mismatch/,
		],
		["last byte flipped", flipped(bytes.length - 1), /checksum mismatch/],
		["middle byte flipped", flipped(bytes.length >> 1), /checksum mismatch/],
		["seed changed", edited(bytes, SEED_WORD, 999), /do not match its hash/],
		["switch flipped", edited(bytes, SWITCH_WORD, 0), /do not match its hash/],
	];
	for (const [name, damaged, error] of cases)
		expect(() => loadWorld(damaged, { modules, species }), name).toThrow(error);
});

test("a save read from an unaligned view loads", () => {
	const world = build();
	world.runRounds(50);
	const bytes = world.save();
	const shifted = new Uint8Array(bytes.length + 1);
	shifted.set(bytes, 1);
	const loaded = loadWorld(shifted.subarray(1), { modules, species });
	expect(loaded.hash()).toBe(world.hash());
});

test("a floor image stored at another floor's position throws", () => {
	const world = createWorld({
		seed: 1,
		floors: 2,
		width: 16,
		height: 16,
		modules,
		species,
	});
	world.spawn(0, rat, 1, 1);
	world.spawn(1, moss, 2, 2);
	world.runRounds(3);
	const bytes = world.save();
	const words = new Int32Array(bytes.buffer);
	const floors = 2;
	const header = 9 + 2 * floors;
	const firstLength = words[9 + floors] ?? 0;
	const secondFloorWord = header + firstLength / 4 + 2;
	words[secondFloorWord] = 0;
	expect(() => loadWorld(bytes, { modules, species })).toThrow(
		/claims floor 0/,
	);
});

// Three floors with their own churn, saved at several points, must resume exactly.
const FLOORS = 3;
const SIDE = 24;
const multiFloor = (
	seed: number,
	table: Readonly<Record<string, SpeciesShape>>,
) => {
	const world = createWorld({
		seed,
		floors: FLOORS,
		width: SIDE,
		height: SIDE,
		popCap: 200,
		modules,
		species: table,
	});
	let s = seed;
	const next = () => {
		s = (Math.imul(s, 1103515245) + 12345) >>> 0;
		return s % SIDE;
	};
	const taken = new Set<number>();
	for (let f = 0; f < FLOORS; f++) {
		taken.clear();
		for (let i = 0; i < 60; i++) {
			const x = next();
			const y = next();
			if (taken.has(y * SIDE + x)) continue;
			taken.add(y * SIDE + x);
			world.spawn(f, rat, x, y);
		}
		for (let i = 0; i < 30; i++) world.spawn(f, cheese, next(), next());
		for (let i = 0; i < 8; i++) world.spawn(f, moss, next(), next());
	}
	return world;
};

for (const [label, table] of [
	["mushrooms", species],
	["walking mushrooms", walkers],
] as const)
	for (const seed of [1, 2, 3, 4])
		for (const at of [1, 7, 33, 120])
			test(`3 floors, ${label}, seed ${seed}, saved at round ${at}`, () => {
				const straight = multiFloor(seed, table);
				straight.runRounds(at + 150);
				const first = multiFloor(seed, table);
				first.runRounds(at);
				const resumed = loadWorld(first.save(), { modules, species: table });
				resumed.runRounds(150);
				expect(resumed.hash()).toBe(straight.hash());
				expect(resumed.save()).toEqual(straight.save());
			});

test("a rebuilt scheduler orders tied actors by id, not by slot", () => {
	let killed = false;
	const reaper = defineModule({
		name: "reaper",
		schema: { mark: { v: "u8" } },
		config: {},
		setup(b) {
			b.tick((ctx) => {
				if (killed) return;
				killed = true;
				ctx.kill(1 as EntityId, 1 as EntityId);
			});
		},
	});
	let turn = 0;
	const order = defineModule({
		name: "order",
		schema: { seen: { n: "i32" } },
		config: {},
		setup(b) {
			const seen = b.write("seen");
			b.tick(() => {
				turn = 0;
			});
			b.propose((_ctx, slot) => {
				turn++;
				seen.n[slot] = turn;
			});
		},
	});
	const list = [reaper, order];
	const actor = { actor: true, components: { seen: {} } };
	const make = () => {
		killed = false;
		const world = createWorld({
			seed: 1,
			floors: 1,
			width: 8,
			height: 8,
			modules: list,
		});
		world.spawn(0, { actor: true, components: { mark: {} } }, 0, 0);
		world.spawn(0, actor, 2, 2);
		world.runRounds(1);
		// Recycles slot 0 with id 3, so slot order (3, 2) is not id order (2, 3).
		world.spawn(0, actor, 4, 4);
		return world;
	};
	const straight = make();
	const loaded = loadWorld(make().save(), { modules: list });
	straight.runRounds(1);
	loaded.runRounds(1);
	const seen = (world: typeof straight) =>
		[2, 3].map((id) => world.peek("seen", "n", id as EntityId));
	expect(seen(straight)).toEqual([1, 2]);
	expect(seen(loaded)).toEqual([1, 2]);
});
