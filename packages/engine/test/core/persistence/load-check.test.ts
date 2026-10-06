import { expect, test } from "bun:test";
import { species } from "../../../src/content/species";
import { cheese } from "../../../src/content/species/cheese";
import { moss } from "../../../src/content/species/moss";
import { rat } from "../../../src/content/species/rat";
import type { EntityId } from "../../../src/core/module/api";
import { Checksum } from "../../../src/core/persistence/checksum";
import { worldDigest } from "../../../src/core/persistence/hash";
import {
	FLOOR_HEADER,
	FREE_COUNT,
	HIGH_WATER,
	imageChecksum,
	SUM,
	sectionCount,
	WORD,
} from "../../../src/core/persistence/image";
import { readWorld } from "../../../src/core/persistence/save";
import { createEngine } from "../../../src/core/setup/registration";
import {
	createWorld,
	type LoadCheck,
	loadWorld,
} from "../../../src/core/world/world";
import { exploreConfig } from "../../../src/modules/explore/config";
import { modules } from "../../../src/registry";
import { idleRounds } from "../../fixtures";

const FLOORS = 3;
const SIDE = 12;
const hungry = {
	...rat,
	components: {
		...rat.components,
		satiety: { value: exploreConfig.restlessBelow - 50 },
	},
};
const stairsTo = (floor: number, x: number, y: number) => ({
	actor: false,
	components: { link: { floor, x, y } },
});

// Restless rats leave by the stairs, so saves hold inbox entries; the player sets the LOD periods.
const build = () => {
	const world = createWorld({
		seed: 3,
		floors: FLOORS,
		width: SIDE,
		height: SIDE,
		modules,
		species,
	});
	const ids: EntityId[] = [];
	for (let f = 0; f < FLOORS; f++) {
		if (f + 1 < FLOORS) world.spawn(f, stairsTo(f + 1, 2, 9), 9, 2);
		if (f > 0) world.spawn(f, stairsTo(f - 1, 9, 2), 2, 9);
		for (let i = 0; i < 8; i++)
			ids.push(world.spawn(f, hungry, (i * 5 + 1) % SIDE, (i * 3 + f) % SIDE));
		world.spawn(f, moss, (7 + f) % SIDE, 5);
	}
	for (let i = 0; i < 20; i++)
		world.spawn(FLOORS - 1, cheese, (i * 7) % SIDE, (i * 5) % SIDE);
	world.spawnPlayer(0, rat, 0, 11);
	return { world, ids };
};

// The first round at which some rat is on the stairs between two floors.
const inTransit = () => {
	const { world, ids } = build();
	for (let round = 1; round < 200; round++) {
		idleRounds(world, 1);
		if (ids.some((id) => world.locate(id) === "transit")) return round;
	}
	throw new Error("no rat ever took the stairs");
};
const SAVED_AT = inTransit();
const AFTER = 60;

const atSave = () => {
	const { world } = build();
	idleRounds(world, SAVED_AT);
	return world;
};

// Where a column's section starts in a floor image, in words.
const engine = createEngine(
	{
		seed: 3,
		floors: FLOORS,
		width: SIDE,
		height: SIDE,
		popCap: 1 << 14,
		events: true,
	},
	modules,
	species,
);
const sectionAt = (image: Uint8Array, array: unknown) => {
	const words = new Int32Array(image.buffer, image.byteOffset, FLOOR_HEADER);
	const highWater = words[HIGH_WATER] ?? 0;
	const freeCount = words[FREE_COUNT] ?? 0;
	let w = FLOOR_HEADER;
	for (const section of engine.sections) {
		if (section.array === array) return w;
		const count = sectionCount(engine, section, highWater, freeCount);
		w += Math.ceil((count * section.unit) / WORD);
	}
	throw new Error("no such section");
};
const reseal = (image: Uint8Array) => {
	const words = new Int32Array(
		image.buffer,
		image.byteOffset,
		image.length / WORD,
	);
	const sum = new Int32Array(2);
	imageChecksum(new Checksum(), words, sum);
	words[SUM] = sum[0] ?? 0;
	words[SUM + 1] = sum[1] ?? 0;
};
// An actor's intent names no registered action: the full check rejects it, and the engine
// would only re-decide that actor.
const unknownIntent = (image: Uint8Array) => {
	const copy = image.slice();
	const at = sectionAt(copy, engine.intentKey);
	const words = new Int32Array(copy.buffer);
	const highWater = words[HIGH_WATER] ?? 0;
	let row = 0;
	while (row < highWater && words[at + row] === 0) row++;
	if (row === highWater) throw new Error("no actor holds an intent");
	words[at + row] = 12345;
	reseal(copy);
	return copy;
};

test("a floor image with a sound checksum but a bad row is refused by the full check only", () => {
	const world = atSave();
	const bad = unknownIntent(world.saveFloor(1));
	expect(() => world.loadFloor(1, bad)).toThrow(/unknown action 12345/);
	expect(() => world.loadFloor(1, bad, { check: "full" })).toThrow(
		/unknown action 12345/,
	);
	expect(() => world.loadFloor(1, bad, { check: "fast" })).not.toThrow();
});

test("a world save loads on the fast check exactly as on the full check", () => {
	const straight = build().world;
	idleRounds(straight, SAVED_AT + AFTER);
	const bytes = atSave().save();
	for (const check of ["fast", "full"] as const) {
		const loaded = loadWorld(bytes, { modules, species, check });
		expect(loaded.save()).toEqual(bytes);
		idleRounds(loaded, AFTER);
		expect(loaded.hash(), check).toBe(straight.hash());
	}
});

test("a floor restored on the fast check runs on exactly as on the full check", () => {
	const straight = build().world;
	idleRounds(straight, SAVED_AT + AFTER);
	for (const check of ["fast", "full"] as const)
		for (let floor = 0; floor < FLOORS; floor++) {
			const live = atSave();
			const image = live.saveFloor(floor);
			// The live floor drifts from its image: the restore must rebuild every derived index.
			live.spawn(floor, cheese, 11, 11);
			live.loadFloor(floor, image, { check });
			idleRounds(live, AFTER);
			expect(live.hash(), `${check} floor ${floor}`).toBe(straight.hash());
		}
});

const flipped = (bytes: Uint8Array, at: number) => {
	const copy = bytes.slice();
	copy[at] = (copy[at] ?? 0) ^ 1;
	return copy;
};
const edited = (bytes: Uint8Array, word: number, value: number) => {
	const copy = bytes.slice();
	new Int32Array(copy.buffer)[word] = value;
	return copy;
};

test("a damaged floor image is refused by both checks", () => {
	const world = atSave();
	const image = world.saveFloor(1);
	const cases: [string, Uint8Array, RegExp][] = [
		["middle byte flipped", flipped(image, image.length >> 1), /checksum/],
		["last byte flipped", flipped(image, image.length - 1), /checksum/],
		["checksum word flipped", flipped(image, SUM * WORD), /checksum/],
		["future version", edited(image, 0, 99), /version/],
		["another registry", edited(image, 1, 7), /fingerprint/],
		["another floor", edited(image, 2, 0), /claims floor 0/],
		["one word short", image.slice(0, image.length - WORD), /words, expected/],
		[
			"high water past its rows",
			edited(image, HIGH_WATER, 1 << 20),
			/high water/,
		],
	];
	for (const check of ["fast", "full"] as const)
		for (const [name, damaged, error] of cases)
			expect(
				() => world.loadFloor(1, damaged, { check }),
				`${check}: ${name}`,
			).toThrow(error);
	expect(() => world.loadFloor(1, image, { check: "fast" })).not.toThrow();
});

test("a damaged world save is refused by both checks", () => {
	const bytes = atSave().save();
	const cases: [string, Uint8Array, RegExp][] = [
		["middle byte flipped", flipped(bytes, bytes.length >> 1), /checksum/],
		["world hash flipped", flipped(bytes, WORD), /do not match its hash/],
		["seed changed", edited(bytes, 3, 999), /do not match its hash/],
		["one word short", bytes.slice(0, bytes.length - WORD), /save file/],
	];
	for (const check of ["fast", "full"] as const)
		for (const [name, damaged, error] of cases)
			expect(
				() => loadWorld(damaged, { modules, species, check }),
				`${check}: ${name}`,
			).toThrow(error);
});

// Edits floor 1 of a world save, then reseals its image and the world hash.
const editedWorld = (
	bytes: Uint8Array,
	edit: (image: Uint8Array) => Uint8Array,
) => {
	const copy = bytes.slice();
	const { header, images } = readWorld(copy);
	images[1]?.set(edit(images[1]));
	const sums = new Int32Array(2 * images.length);
	images.forEach((image, f) => {
		const words = new Int32Array(image.buffer, image.byteOffset, FLOOR_HEADER);
		sums[2 * f] = words[SUM] ?? 0;
		sums[2 * f + 1] = words[SUM + 1] ?? 0;
	});
	const words = new Int32Array(copy.buffer);
	worldDigest(
		new Checksum(),
		header,
		header.events,
		sums,
		words.subarray(1, 3),
	);
	return copy;
};

test("a world save with sound hashes but a bad row is refused by the full check only", () => {
	const bad = editedWorld(atSave().save(), unknownIntent);
	expect(() => loadWorld(bad, { modules, species })).toThrow(
		/unknown action 12345/,
	);
	expect(() => loadWorld(bad, { modules, species, check: "full" })).toThrow(
		/unknown action 12345/,
	);
	expect(() =>
		loadWorld(bad, { modules, species, check: "fast" }),
	).not.toThrow();
});

// Two live rows share an id: the index would reach only one of them.
const sharedId = (image: Uint8Array) => {
	const copy = image.slice();
	const at = sectionAt(copy, engine.storage.ids);
	const words = new Int32Array(copy.buffer);
	const masks = sectionAt(copy, engine.storage.masks);
	const live = [];
	for (let row = 0; row < (words[HIGH_WATER] ?? 0); row++)
		if (((words[masks + row * engine.storage.maskWords] ?? 0) & 1) !== 0)
			live.push(row);
	const [first = 0, second = 0] = live;
	words[at + second] = words[at + first] ?? 0;
	reseal(copy);
	return copy;
};

test("both checks refuse two rows with one id, even behind sound hashes", () => {
	const world = atSave();
	const bad = sharedId(world.saveFloor(1));
	for (const check of ["fast", "full"] as const)
		expect(() => world.loadFloor(1, bad, { check }), check).toThrow(
			/held by two slots/,
		);
	const badWorld = editedWorld(world.save(), sharedId);
	for (const check of ["fast", "full"] as const)
		expect(
			() => loadWorld(badWorld, { modules, species, check }),
			check,
		).toThrow(/held by two slots/);
});

test("the fast check still refuses a floor image whose traffic or round point differs", () => {
	const quiet = atSave();
	const image = quiet.saveFloor(1);
	const moved = atSave();
	// One more round: the image no longer fits the live floor's time.
	idleRounds(moved, 1);
	expect(() => moved.loadFloor(1, image, { check: "fast" })).toThrow(
		/do not fit round/,
	);
	const paused = atSave();
	expect(paused.advance().length).toBe(1);
	expect(() => paused.loadFloor(1, image, { check: "fast" })).toThrow(
		/round boundary/,
	);
	expect(() =>
		quiet.loadFloor(0, paused.saveFloor(0), { check: "fast" }),
	).toThrow(/saved mid-round/);
});

test("the fast check still refuses a floor image from before a trip by the stairs", () => {
	const twoFloors = (travel: boolean) => {
		const world = createWorld({
			seed: 1,
			floors: 2,
			width: SIDE,
			height: SIDE,
			modules,
			species,
		});
		world.spawn(0, stairsTo(1, 5, 5), 3, 3);
		world.spawnPlayer(0, rat, 2, 2);
		for (let due = world.advance(); due.length > 0; due = world.advance())
			for (const p of due)
				world.input(p, travel ? "core/travel" : "core/idle", travel ? 1 : null);
		return world;
	};
	const quiet = twoFloors(false);
	const busy = twoFloors(true);
	expect(() =>
		busy.loadFloor(1, quiet.saveFloor(1), { check: "fast" }),
	).toThrow(/traffic/);
});

// A live row of floor 1 takes id 1, the stairs floor 0 issued and still holds.
const borrowedId = (image: Uint8Array) => {
	const copy = image.slice();
	const words = new Int32Array(copy.buffer);
	const ids = sectionAt(copy, engine.storage.ids);
	const masks = sectionAt(copy, engine.storage.masks);
	let row = 0;
	while (((words[masks + row * engine.storage.maskWords] ?? 0) & 1) === 0)
		row++;
	words[ids + row] = 1;
	reseal(copy);
	return copy;
};

test("an id living on two floors is refused unless the check is exactly fast", () => {
	const bad = editedWorld(atSave().save(), borrowedId);
	expect(() => loadWorld(bad, { modules, species })).toThrow(/lives twice/);
	const unknown = "quick" as LoadCheck;
	expect(() => loadWorld(bad, { modules, species, check: unknown })).toThrow(
		/lives twice/,
	);
	expect(() =>
		loadWorld(bad, { modules, species, check: "fast" }),
	).not.toThrow();
});
