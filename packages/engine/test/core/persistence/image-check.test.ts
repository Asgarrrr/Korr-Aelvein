import { expect, test } from "bun:test";
import { species } from "../../../src/content/species";
import { cheese } from "../../../src/content/species/cheese";
import { moss } from "../../../src/content/species/moss";
import { CAP, ID_FLOOR_STRIDE } from "../../../src/core/config";
import { ACTOR, ALIVE } from "../../../src/core/ecs/storage";
import type { Engine } from "../../../src/core/engine";
import { place } from "../../../src/core/lifecycle/lifecycle";
import { compileSpecies } from "../../../src/core/lifecycle/species";
import { Checksum } from "../../../src/core/persistence/checksum";
import {
	FLOOR_HEADER,
	FREE_COUNT,
	HIGH_WATER,
	imageChecksum,
	SUM,
	saveFloor,
	sectionCount,
	WORD,
} from "../../../src/core/persistence/image";
import { loadFloor } from "../../../src/core/persistence/validate";
import { hashName } from "../../../src/core/random/rng";
import { createEngine } from "../../../src/core/setup/registration";
import { END } from "../../../src/core/space/grid";
import { createWorld } from "../../../src/core/world";
import { modules } from "../../../src/registry";
import { populatedWorld } from "../../fixtures";

const ROUND = 130;
const POP_CAP = 120;
const source = populatedWorld(1, modules, 50, { popCap: POP_CAP }).world;
for (let i = 0; i < 10; i++) source.spawn(0, moss, (i * 7) % 32, (i * 13) % 32);
source.runRounds(ROUND);
const image = source.saveFloor(0);

const freshEngine = (round = ROUND, side = 32) => {
	const engine = createEngine(
		{
			seed: 1,
			floors: 1,
			width: side,
			height: side,
			popCap: POP_CAP,
			events: true,
		},
		modules,
		species,
	);
	engine.round = round;
	return engine;
};

// Where each section of `bytes` starts, from the engine's own section table.
const sectionsOf = (engine: Engine, bytes: Uint8Array) => {
	const words = new Int32Array(bytes.buffer);
	const highWater = words[HIGH_WATER] ?? 0;
	const freeCount = words[FREE_COUNT] ?? 0;
	const at = new Map<unknown, number>();
	let w = FLOOR_HEADER;
	for (const section of engine.sections) {
		at.set(section.array, w);
		const count = sectionCount(engine, section, highWater, freeCount);
		w += Math.ceil((count * section.unit) / WORD);
	}
	return at;
};

const reseal = (bytes: Uint8Array) => {
	const words = new Int32Array(bytes.buffer);
	const sum = new Int32Array(2);
	imageChecksum(new Checksum(), words, sum);
	words[SUM] = sum[0] ?? 0;
	words[SUM + 1] = sum[1] ?? 0;
	return bytes;
};

const engine = freshEngine();
const at = sectionsOf(engine, image);
const { storage, grid, scheduler } = engine;
const view16 = (bytes: Uint8Array, array: unknown) =>
	new Int16Array(bytes.buffer, (at.get(array) ?? 0) * WORD);
const view32 = (bytes: Uint8Array, array: unknown) =>
	new Int32Array(bytes.buffer, (at.get(array) ?? 0) * WORD);
const keyOf = (name: string) => hashName(name) | 0;
const satiety = engine.components.get("satiety")?.columns.value;

// Rows to corrupt, found in the image itself.
const masks = view32(image, storage.masks);
const words = storage.maskWords;
const highWater = new Int32Array(image.buffer)[HIGH_WATER] ?? 0;
const rows = [...Array(highWater).keys()];
const isLive = (r: number) => ((masks[r * words] ?? 0) & ALIVE) !== 0;
const isActor = (r: number) => ((masks[r * words] ?? 0) & ACTOR) !== 0;
const ratRow = rows.find((r) => isLive(r) && isActor(r)) ?? -1;
const [itemRow = -1, otherItemRow = -1] = rows.filter(
	(r) => isLive(r) && !isActor(r),
);
const lacks = (name: string) => {
	const bit = engine.components.get(name)?.bit ?? { word: 0, bit: 0 };
	return rows.find(
		(r) => isLive(r) && ((masks[r * words + bit.word] ?? 0) & bit.bit) === 0,
	);
};
const dietless = lacks("diet") ?? -1;
const inedible = lacks("edible") ?? -1;
const set16Field =
	(array: unknown, index: number, value: number): Edit =>
	(copy) => {
		view16(copy, array)[index] = value;
	};
const set8 =
	(array: unknown, index: number, value: number): Edit =>
	(copy) => {
		new Uint8Array(copy.buffer, (at.get(array) ?? 0) * WORD)[index] = value;
	};
const freeList = view32(image, storage.free);
const freeRow = freeList[0] ?? -1;
const cellOf = view32(image, grid.cellOf);
const next = view32(image, grid.next);
const prev = view32(image, grid.prev);
const heads = view32(image, grid.heads);
const loneRow =
	rows.find((r) => isLive(r) && next[r] === END && prev[r] === END) ?? -1;
const emptyCell = [...Array(grid.cells).keys()].find(
	(c) => heads[c] === END && c < (cellOf[itemRow] ?? 0),
);

type Edit = (copy: Uint8Array) => void;
const set32 =
	(array: unknown, index: number, value: number): Edit =>
	(copy) => {
		view32(copy, array)[index] = value;
	};
const set16 =
	(array: unknown, index: number, value: number): Edit =>
	(copy) => {
		view16(copy, array)[index] = value;
	};

test("the corruption probes found the rows they need", () => {
	expect([
		ratRow,
		itemRow,
		otherItemRow,
		freeRow,
		loneRow,
		dietless,
		inedible,
	]).not.toContain(-1);
	expect(emptyCell).toBeDefined();
	expect(() => loadFloor(freshEngine(), image, 0)).not.toThrow();
});

const cases: [string, Edit, RegExp][] = [
	["free slot listed twice", set32(storage.free, 1, freeRow), /listed twice/],
	["free slot out of range", set32(storage.free, 0, CAP), /out of range/],
	[
		"free slot that is alive",
		set32(storage.free, 0, itemRow),
		/holds an entity/,
	],
	[
		"actor bit without alive bit",
		set32(storage.masks, ratRow * words, ACTOR),
		/actor but not alive/,
	],
	[
		"slot neither alive nor free",
		set32(storage.masks, itemRow * words, 0),
		/neither alive nor free/,
	],
	["dead slot keeps an id", set32(storage.ids, freeRow, 5), /keeps an id/],
	["dead slot keeps a position", set16(grid.x, freeRow, 1), /keeps a position/],
	[
		"id this floor never issued",
		set32(storage.ids, itemRow, CAP * CAP),
		/not one this floor issued/,
	],
	["live id zero", set32(storage.ids, itemRow, 0), /not one this floor issued/],
	[
		"id held twice",
		(copy) => {
			const ids = view32(copy, storage.ids);
			ids[otherItemRow] = ids[itemRow] ?? 0;
		},
		/held by two slots/,
	],
	[
		"actor due in the past",
		set32(scheduler.nextAt, ratRow, 0),
		/next acts at 0/,
	],
	["position off the floor", set16(grid.x, itemRow, 99), /off the floor/],
	[
		"cell not matching position",
		set32(grid.cellOf, itemRow, ((cellOf[itemRow] ?? 0) + 1) % grid.cells),
		/does not match/,
	],
	[
		"head on a dead slot",
		set32(grid.heads, emptyCell ?? 0, freeRow),
		/lists dead slot/,
	],
	[
		"head outside the floor",
		set32(grid.heads, emptyCell ?? 0, CAP + 5),
		/outside this floor/,
	],
	["list cycle", set32(grid.next, itemRow, itemRow), /twice or in a cycle/],
	[
		"intent naming no registered action",
		set32(engine.intentKey, ratRow, 12345),
		/intends unknown action 12345/,
	],
	[
		"no intent but a target",
		(copy) => {
			view32(copy, engine.intentKey)[ratRow] = 0;
			view32(copy, engine.intentTarget)[ratRow] = 7;
		},
		/intends target 7/,
	],
	[
		"a targetless intent with a target",
		(copy) => {
			view32(copy, engine.intentKey)[ratRow] = keyOf("core/idle");
			view32(copy, engine.intentTarget)[ratRow] = 5;
		},
		/intends target 5/,
	],
	[
		"a step intent off the floor",
		(copy) => {
			view32(copy, engine.intentKey)[ratRow] = keyOf("core/step");
			view32(copy, engine.intentTarget)[ratRow] = grid.cells;
		},
		new RegExp(`intends target ${grid.cells}`),
	],
	[
		"an entity intent with no entity",
		(copy) => {
			view32(copy, engine.intentKey)[ratRow] = keyOf("hunger/eat");
			view32(copy, engine.intentTarget)[ratRow] = 0;
		},
		/intends target 0/,
	],
	[
		"an entity intent with a negative target",
		(copy) => {
			view32(copy, engine.intentKey)[ratRow] = keyOf("hunger/eat");
			view32(copy, engine.intentTarget)[ratRow] = -5;
		},
		/intends target -5/,
	],
	[
		"an entity intent outside the id encoding",
		(copy) => {
			view32(copy, engine.intentKey)[ratRow] = keyOf("hunger/eat");
			view32(copy, engine.intentTarget)[ratRow] = ID_FLOOR_STRIDE;
		},
		new RegExp(`intends target ${ID_FLOOR_STRIDE}`),
	],
	[
		"an intent on a creature that does not act",
		set32(engine.intentKey, itemRow, keyOf("core/idle")),
		/does not act/,
	],
	[
		"a next turn on a creature that does not act",
		set32(scheduler.nextAt, itemRow, ROUND * 100),
		/does not act/,
	],
	[
		"a byte-wide value in a component the row does not have",
		set8(engine.components.get("diet")?.columns.eats, dietless, 1),
		/component it does not have/,
	],
	[
		"a 16-bit value in a component the row does not have",
		set16Field(engine.components.get("edible")?.columns.nutrition, inedible, 7),
		/component it does not have/,
	],
	[
		"a mask bit no component owns",
		set32(storage.masks, itemRow * words, ALIVE | (1 << 30)),
		/unknown mask bits/,
	],
	[
		"an entity intent on a floor the world does not have",
		(copy) => {
			view32(copy, engine.intentKey)[ratRow] = keyOf("hunger/eat");
			view32(copy, engine.intentTarget)[ratRow] = ID_FLOOR_STRIDE + 5;
		},
		new RegExp(`intends target ${ID_FLOOR_STRIDE + 5}`),
	],
	[
		"a step intent to cell -1",
		(copy) => {
			view32(copy, engine.intentKey)[ratRow] = keyOf("core/step");
			view32(copy, engine.intentTarget)[ratRow] = -1;
		},
		/intends target -1,/,
	],
	[
		"a value in a component the row does not have",
		set32(satiety, itemRow, 5),
		/component it does not have/,
	],
	[
		"dead slot keeps an intent",
		set32(engine.intentKey, freeRow, keyOf("core/idle")),
		/dead slot \d+ keeps a value/,
	],
	[
		"dead slot keeps a module value",
		set32(satiety, freeRow, 3),
		/dead slot \d+ keeps a value/,
	],
	["broken back link", set32(grid.prev, itemRow, 12345), /links back/],
	[
		"entity listed under another cell",
		set32(grid.heads, emptyCell ?? 0, itemRow),
		/which sits in/,
	],
	[
		"live slot in no list",
		set32(grid.heads, cellOf[loneRow] ?? 0, END),
		/in no cell list/,
	],
];

for (const [name, edit, error] of cases)
	test(`a floor image with ${name} throws`, () => {
		const copy = image.slice();
		edit(copy);
		expect(() => loadFloor(freshEngine(), reseal(copy), 0)).toThrow(error);
	});

test("a floor image with two actors in one cell throws", () => {
	const crowded = freshEngine(0);
	const body = compileSpecies(
		{ actor: true, components: {} },
		crowded.components,
		crowded.storage.maskWords,
	);
	place(crowded, 0, body, 3, 3, 0);
	place(crowded, 0, body, 3, 3, 0);
	expect(() => loadFloor(freshEngine(0), saveFloor(crowded, 0), 0)).toThrow(
		/two actors/,
	);
});

test("an edit without a new checksum throws on the checksum", () => {
	const copy = image.slice();
	set32(storage.ids, itemRow, 0)(copy);
	expect(() => loadFloor(freshEngine(), copy, 0)).toThrow(/checksum mismatch/);
});

test("nonzero padding after a section throws", () => {
	const small = createWorld({
		seed: 1,
		floors: 1,
		width: 32,
		height: 32,
		popCap: POP_CAP,
		modules,
		species,
	});
	for (let i = 0; i < 3; i++) small.spawn(0, cheese, i, 0);
	const bytes = small.saveFloor(0);
	const target = freshEngine(0);
	// Three i16 positions fill six bytes: the last two bytes of the x section's second word are padding.
	const xWord = (sectionsOf(target, bytes).get(target.grid.x) ?? 0) + 1;
	const all = new Int32Array(bytes.buffer);
	all[xWord] = (all[xWord] ?? 0) | (1 << 16);
	expect(() => loadFloor(target, reseal(bytes), 0)).toThrow(/padding/);
});

test("a rejected image leaves the floor as it was", () => {
	const target = freshEngine();
	const before = saveFloor(target, 0);
	const copy = image.slice();
	set32(grid.prev, itemRow, 12345)(copy);
	expect(() => loadFloor(target, reseal(copy), 0)).toThrow();
	expect(saveFloor(target, 0)).toEqual(before);
});
