import { CAP, ID_FLOOR_STRIDE, MAX_TICK, TICKS_PER_TURN } from "../config";
import { ACTOR, ALIVE, indexInsert } from "../ecs/storage";
import type { Engine } from "../engine";
import { END } from "../space/grid";
import {
	COUNTER,
	FINGERPRINT,
	FLOOR,
	FLOOR_HEADER,
	FORMAT_VERSION,
	FREE_COUNT,
	HIGH_WATER,
	imageChecksum,
	imageWords,
	readFloor,
	type Section,
	SUM,
	sectionCount,
	TIME,
	tailMask,
	VERSION,
	WORD,
} from "./image";

export function checkVersion(version: number | undefined): void {
	if (version !== FORMAT_VERSION)
		throw new Error(
			`image format version ${version}, expected ${FORMAT_VERSION}`,
		);
}

const sums = new Int32Array(2);

// Reads only the image: a bad one throws before any engine state changes.
// Fills `index` with the floor's id index, which readFloor then adopts.
export function checkFloor(
	engine: Engine,
	image: Uint8Array,
	floor: number,
	round: number,
	index: Int32Array,
): void {
	const fail = (why: string): never => {
		throw new Error(`floor ${floor} image: ${why}`);
	};
	if (image.byteOffset % WORD !== 0 || image.length % WORD !== 0)
		fail("not word-aligned");
	if (image.length < FLOOR_HEADER * WORD) fail("truncated header");
	const words = new Int32Array(
		image.buffer,
		image.byteOffset,
		image.length / WORD,
	);
	checkVersion(words[VERSION]);
	if (words[FINGERPRINT] !== (engine.fingerprint | 0))
		throw new Error("image registry fingerprint does not match these modules");
	if (words[FLOOR] !== floor) fail(`claims floor ${words[FLOOR]}`);
	const highWater = words[HIGH_WATER] ?? 0;
	const freeCount = words[FREE_COUNT] ?? 0;
	const counter = words[COUNTER] ?? 0;
	const now = words[TIME] ?? 0;
	if (!(freeCount >= 0 && freeCount <= highWater && highWater <= engine.popCap))
		fail(`free count ${freeCount}, high water ${highWater}`);
	if (!(counter >= highWater && counter < ID_FLOOR_STRIDE))
		fail(`id counter ${counter}`);
	if (now !== round * TICKS_PER_TURN) fail(`time ${now} is not round ${round}`);
	const expected = imageWords(engine, highWater, freeCount);
	if (words.length !== expected)
		fail(`${words.length} words, expected ${expected}`);
	imageChecksum(engine.sum, words, sums);
	if (sums[0] !== words[SUM] || sums[1] !== words[SUM + 1])
		fail("checksum mismatch");

	const { storage, grid, scheduler, sections } = engine;
	const at = new Map<unknown, { at: number; count: number }>();
	let w = FLOOR_HEADER;
	for (let i = 0; i < sections.length; i++) {
		const section = sections[i] as Section;
		const count = sectionCount(engine, section, highWater, freeCount);
		const bytes = count * section.unit;
		at.set(section.array, { at: image.byteOffset + w * WORD, count });
		const tail = bytes & (WORD - 1);
		const last = w + (bytes >> 2);
		if (tail !== 0 && ((words[last] ?? 0) & ~tailMask(tail)) !== 0)
			fail(`padding after section ${i} is not zero`);
		w += Math.ceil(bytes / WORD);
	}
	const int32 = (array: unknown) => {
		const view = at.get(array) ?? { at: 0, count: 0 };
		return new Int32Array(image.buffer, view.at, view.count);
	};
	const int16 = (array: unknown) => {
		const view = at.get(array) ?? { at: 0, count: 0 };
		return new Int16Array(image.buffer, view.at, view.count);
	};
	const rows: Rows = {
		base: floor * CAP,
		highWater,
		maskWords: storage.maskWords,
		ids: int32(storage.ids),
		masks: int32(storage.masks),
		cellOf: int32(grid.cellOf),
		next: int32(grid.next),
		prev: int32(grid.prev),
	};
	const code =
		checkFree(rows, int32(storage.free), freeCount, engine.checkFreed) ||
		checkLive(
			rows,
			engine.checkFreed,
			index,
			floor * ID_FLOOR_STRIDE,
			counter,
			now,
			int32(scheduler.nextAt),
			int16(grid.x),
			int16(grid.y),
			grid.width,
			grid.height,
		) ||
		checkLists(rows, int32(grid.heads), grid.cells, engine.checkListed);
	if (code !== OK) fail(describe(code));
}

const OK = 0;
const FREE_RANGE = 1;
const FREE_TWICE = 2;
const FREE_ALIVE = 3;
const ACTOR_DEAD = 4;
const NEITHER = 5;
const DEAD_LINKS = 6;
const DEAD_POSITION = 7;
const FOREIGN_ID = 8;
const SHARED_ID = 9;
const NEXT_AT = 10;
const OFF_FLOOR = 11;
const WRONG_CELL = 12;
const LIST_OUTSIDE = 13;
const LIST_DEAD = 14;
const LIST_TWICE = 15;
const LIST_CELL = 16;
const LIST_BACK = 17;
const UNLISTED = 18;

// The slot and the value a failed check reports: plain numbers, so the hot loops close over nothing.
const problem = new Int32Array(2);
// checkLive leaves the live count here for checkLists.
const tally = new Int32Array(1);
const report = (code: number, slot: number, value: number) => {
	problem[0] = slot;
	problem[1] = value;
	return code;
};

function describe(code: number): string {
	const slot = problem[0] ?? 0;
	const value = problem[1] ?? 0;
	switch (code) {
		case FREE_RANGE:
			return `free slot ${slot} out of range`;
		case FREE_TWICE:
			return `free slot ${slot} listed twice`;
		case FREE_ALIVE:
			return `free slot ${slot} holds an entity`;
		case ACTOR_DEAD:
			return `slot ${slot} is an actor but not alive`;
		case NEITHER:
			return `slot ${slot} is neither alive nor free`;
		case DEAD_LINKS:
			return `dead slot ${slot} keeps an id or grid links`;
		case DEAD_POSITION:
			return `dead slot ${slot} keeps a position`;
		case FOREIGN_ID:
			return `slot ${slot} holds id ${value}, not one this floor issued`;
		case SHARED_ID:
			return `id ${value} is held by two slots`;
		case NEXT_AT:
			return `actor in slot ${slot} next acts at ${value}, outside [now, ${MAX_TICK}]`;
		case OFF_FLOOR:
			return `slot ${slot} sits off the floor`;
		case WRONG_CELL:
			return `slot ${slot} cell ${value} does not match its position`;
		case LIST_OUTSIDE:
			return `cell ${value} lists slot ${slot}, outside this floor`;
		case LIST_DEAD:
			return `cell ${value} lists dead slot ${slot}`;
		case LIST_TWICE:
			return `slot ${slot} is listed twice or in a cycle`;
		case LIST_CELL:
			return `cell ${value} lists slot ${slot}, which sits in another cell`;
		case LIST_BACK:
			return `slot ${slot} links back to ${value}`;
		default:
			return `${value} live slots are in no cell list`;
	}
}

interface Rows {
	readonly base: number;
	readonly highWater: number;
	readonly maskWords: number;
	readonly ids: Int32Array;
	readonly masks: Int32Array;
	readonly cellOf: Int32Array;
	readonly next: Int32Array;
	readonly prev: Int32Array;
}

function checkFree(
	rows: Rows,
	free: Int32Array,
	freeCount: number,
	freed: Uint8Array,
): number {
	const { base, highWater, maskWords, masks } = rows;
	freed.fill(0, 0, highWater);
	for (let i = 0; i < freeCount; i++) {
		const slot = free[i] ?? 0;
		const row = slot - base;
		if (!(row >= 0 && row < highWater)) return report(FREE_RANGE, slot, 0);
		if (freed[row] !== 0) return report(FREE_TWICE, slot, 0);
		freed[row] = 1;
		for (let m = 0; m < maskWords; m++)
			if (masks[row * maskWords + m] !== 0) return report(FREE_ALIVE, slot, 0);
	}
	return OK;
}

function checkLive(
	rows: Rows,
	freed: Uint8Array,
	index: Int32Array,
	firstId: number,
	counter: number,
	now: number,
	nextAt: Int32Array,
	x: Int16Array,
	y: Int16Array,
	width: number,
	height: number,
): number {
	const { base, highWater, maskWords, ids, masks, cellOf, next, prev } = rows;
	index.fill(0);
	let live = 0;
	for (let row = 0; row < highWater; row++) {
		const slot = base + row;
		const mask = masks[row * maskWords] ?? 0;
		if ((mask & ALIVE) === 0) {
			if ((mask & ACTOR) !== 0) return report(ACTOR_DEAD, slot, 0);
			if (freed[row] === 0) return report(NEITHER, slot, 0);
			if (ids[row] !== 0 || next[row] !== 0 || prev[row] !== 0)
				return report(DEAD_LINKS, slot, 0);
			if (cellOf[row] !== 0 || x[row] !== 0 || y[row] !== 0)
				return report(DEAD_POSITION, slot, 0);
			continue;
		}
		live++;
		const id = ids[row] ?? 0;
		const serial = id - firstId;
		if (!(serial >= 1 && serial <= counter))
			return report(FOREIGN_ID, slot, id);
		if (!indexInsert(index, 0, ids, base, id, slot))
			return report(SHARED_ID, slot, id);
		if ((mask & ACTOR) !== 0) {
			const due = nextAt[row] ?? 0;
			if (!(due >= now && due <= MAX_TICK)) return report(NEXT_AT, slot, due);
		}
		const px = x[row] ?? 0;
		const py = y[row] ?? 0;
		if (!(px >= 0 && px < width && py >= 0 && py < height))
			return report(OFF_FLOOR, slot, 0);
		if (cellOf[row] !== py * width + px)
			return report(WRONG_CELL, slot, cellOf[row] ?? 0);
	}
	tally[0] = live;
	return OK;
}

// Walks every cell's list once: visiting each live slot exactly once proves the lists are
// acyclic, disjoint and complete.
function checkLists(
	rows: Rows,
	heads: Int32Array,
	cells: number,
	listed: Uint8Array,
): number {
	const { base, highWater, maskWords, masks, cellOf, next, prev } = rows;
	listed.fill(0, 0, highWater);
	const live = tally[0] ?? 0;
	let seen = 0;
	for (let cell = 0; cell < cells; cell++) {
		let before = END;
		let slot = heads[cell] ?? END;
		while (slot !== END) {
			const row = slot - base;
			if (!(row >= 0 && row < highWater))
				return report(LIST_OUTSIDE, slot, cell);
			if (((masks[row * maskWords] ?? 0) & ALIVE) === 0)
				return report(LIST_DEAD, slot, cell);
			if (listed[row] !== 0) return report(LIST_TWICE, slot, 0);
			listed[row] = 1;
			seen++;
			if (cellOf[row] !== cell) return report(LIST_CELL, slot, cell);
			if (prev[row] !== before) return report(LIST_BACK, slot, prev[row] ?? 0);
			before = slot;
			slot = next[row] ?? END;
		}
	}
	return seen === live ? OK : report(UNLISTED, 0, live - seen);
}

export function loadFloor(
	engine: Engine,
	image: Uint8Array,
	floor: number,
): void {
	checkFloor(engine, image, floor, engine.round, engine.checkIndex);
	readFloor(engine, image, engine.checkIndex);
}
