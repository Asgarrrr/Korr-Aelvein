import { expect, test } from "bun:test";
import { species } from "../../../src/content/species";
import { cheese } from "../../../src/content/species/cheese";
import { moss } from "../../../src/content/species/moss";
import { rat } from "../../../src/content/species/rat";
import type { EntityId } from "../../../src/core/api";
import { CAP, ID_FLOOR_STRIDE } from "../../../src/core/config";
import { ACTOR, ALIVE } from "../../../src/core/ecs/storage";
import { Checksum } from "../../../src/core/persistence/checksum";
import {
	FLOOR_HEADER,
	FREE_COUNT,
	HIGH_WATER,
	imageChecksum,
	SUM,
	sectionCount,
	TIME,
	WORD,
} from "../../../src/core/persistence/image";
import { createEngine } from "../../../src/core/setup/registration";
import { END } from "../../../src/core/space/grid";
import { createWorld, type LoadCheck } from "../../../src/core/world";
import { modules } from "../../../src/registry";

const SIDE = 32;
const POP_CAP = 120;
const FLOOR = 1;
// A slot of floor 0: valid memory, but not this floor's.
const FOREIGN = 5;

// Floor 1 is churned until rats have eaten, so its image holds free slots, actors, items and
// stairs;
// floor 0 makes slots below CAP someone else's.
const shape = {
	seed: 1,
	floors: 2,
	width: SIDE,
	height: SIDE,
	popCap: POP_CAP,
};
const world = createWorld({ ...shape, modules, species });
const STAIRS_X = 31;
world.spawn(
	FLOOR,
	{ actor: false, components: { link: { floor: 0, x: 3, y: 3 } } },
	STAIRS_X,
	STAIRS_X,
);
for (let f = 0; f < 2; f++)
	for (let i = 0; i < 50; i++) {
		world.spawn(f, rat, (i % 10) * 3, Math.floor(i / 10) * 6);
		world.spawn(f, cheese, (i * 5 + 3) % SIDE, (i * 3 + 1) % SIDE);
	}
for (let i = 0; i < 10; i++)
	world.spawn(FLOOR, moss, (i * 7) % SIDE, (i * 13) % SIDE);
world.runRounds(130);
const image = world.saveFloor(FLOOR);

const engine = createEngine({ ...shape, events: true }, modules, species);
const header = new Int32Array(image.buffer, 0, FLOOR_HEADER);
const highWater = header[HIGH_WATER] ?? 0;
const at = new Map<unknown, number>();
let w = FLOOR_HEADER;
for (const section of engine.sections) {
	at.set(section.array, w);
	const count = sectionCount(
		engine,
		section,
		highWater,
		header[FREE_COUNT] ?? 0,
	);
	w += Math.ceil((count * section.unit) / WORD);
}
const words = new Int32Array(image.buffer);
const word = (array: unknown, index: number) =>
	words[(at.get(array) ?? 0) + index] ?? 0;
const mask = (row: number) =>
	word(engine.storage.masks, row * engine.storage.maskWords);
const rows = [...Array(highWater).keys()];
const isLive = (r: number) => (mask(r) & ALIVE) !== 0;
const actorRow = rows.find((r) => isLive(r) && (mask(r) & ACTOR) !== 0) ?? -1;
const itemRow = rows.find((r) => isLive(r) && (mask(r) & ACTOR) === 0) ?? -1;
const stairsRow =
	rows.find(
		(r) =>
			isLive(r) &&
			(word(
				engine.storage.masks,
				r * engine.storage.maskWords + engine.link.word,
			) &
				engine.link.bit) !==
				0,
	) ?? -1;
const emptyCell = [...Array(SIDE * SIDE).keys()].find(
	(c) => word(engine.grid.heads, c) === END,
);

// The checksum is recomputed, so only checks of the rows themselves can refuse the edit.
const resealed = (
	array: unknown,
	index: number,
	value: number,
	unit = WORD,
) => {
	const copy = image.slice();
	const all = new Int32Array(copy.buffer);
	if (unit === 1) copy[(at.get(array) ?? 0) * WORD + index] = value;
	else all[(at.get(array) ?? 0) + index] = value;
	const sums = new Int32Array(2);
	imageChecksum(new Checksum(), all, sums);
	all[SUM] = sums[0] ?? 0;
	all[SUM + 1] = sums[1] ?? 0;
	return copy;
};

test("the probes found an actor, an item, stairs, an empty cell and a free slot", () => {
	expect([actorRow, itemRow, stairsRow]).not.toContain(-1);
	expect(emptyCell).toBeDefined();
	expect(header[FREE_COUNT]).toBeGreaterThan(0);
	expect(() => world.loadFloor(FLOOR, image, { check: "fast" })).not.toThrow();
});

const { grid, scheduler, storage } = engine;
const now = header[TIME] ?? 0;
// Each would make the engine write memory off its floor, or schedule outside the round.
const faults: [string, Uint8Array, RegExp][] = [
	[
		"an actor's cell far off the floor",
		resealed(grid.cellOf, actorRow, 1 << 20),
		/cell/,
	],
	["an item's negative cell", resealed(grid.cellOf, itemRow, -1), /cell/],
	[
		"a cell one past the last",
		resealed(grid.cellOf, itemRow, SIDE * SIDE),
		/cell/,
	],
	[
		"an actor due long before now",
		resealed(scheduler.nextAt, actorRow, -2e9),
		/next acts at/,
	],
	[
		"an actor due just before now",
		resealed(scheduler.nextAt, actorRow, now - 1),
		/next acts at/,
	],
	[
		"a free slot past the high water",
		resealed(storage.free, 0, CAP + highWater),
		/free slot/,
	],
	["a free slot of floor 0", resealed(storage.free, 0, CAP - 1), /free slot/],
	["a negative free slot", resealed(storage.free, 0, -1), /free slot/],
	[
		"an empty cell heading a floor-0 slot",
		resealed(grid.heads, emptyCell ?? 0, FOREIGN),
		/lists slot/,
	],
	[
		"an empty cell heading the slot past the high water",
		resealed(grid.heads, emptyCell ?? 0, CAP + highWater),
		/lists slot/,
	],
	[
		"a next link to the slot past the high water",
		resealed(grid.next, actorRow, CAP + highWater),
		/links to slot/,
	],
	[
		"a next link to a floor-0 slot",
		resealed(grid.next, actorRow, FOREIGN),
		/links to slot/,
	],
	[
		"a prev link to a floor-0 slot",
		resealed(grid.prev, itemRow, FOREIGN),
		/links to slot/,
	],
	[
		"stairs to a floor the world does not have",
		resealed(engine.link.floor, stairsRow, 2, 1),
		/link/,
	],
	[
		"stairs to their own floor",
		resealed(engine.link.floor, stairsRow, FLOOR, 1),
		/link/,
	],
];

for (const [name, bad, error] of faults)
	test(`the fast check refuses ${name}, even behind a sound checksum`, () => {
		expect(() => world.loadFloor(FLOOR, bad, { check: "fast" })).toThrow(error);
		expect(() => world.loadFloor(FLOOR, bad, { check: "full" })).toThrow();
	});

// A stale index entry from an earlier load would either find a false duplicate (the same floor
// again) or hand a later floor an entity of another floor.
test("consecutive loads of different floors and checks leave no stale id behind", () => {
	const images = [world.saveFloor(0), world.saveFloor(FLOOR)];
	const where = new Map<number, number>();
	for (let f = 0; f < 2; f++)
		for (let k = 1; k <= 400; k++) {
			const id = f * ID_FLOOR_STRIDE + k;
			const at = world.locate(id as EntityId);
			if (typeof at === "object") where.set(id, at.floor);
		}
	const before = world.hash();
	const loads: [number, LoadCheck][] = [
		[FLOOR, "fast"],
		[FLOOR, "fast"],
		[0, "fast"],
		[FLOOR, "full"],
		[FLOOR, "fast"],
		[0, "fast"],
		[0, "fast"],
		[FLOOR, "fast"],
	];
	for (const [floor, check] of loads) {
		world.loadFloor(floor, images[floor] as Uint8Array, { check });
		for (const [id, floorOf] of where)
			expect(world.locate(id as EntityId)).toMatchObject({ floor: floorOf });
	}
	expect(where.size).toBeGreaterThan(100);
	expect(world.hash()).toBe(before);
});
