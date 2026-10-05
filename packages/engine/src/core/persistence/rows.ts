import { MAX_TICK } from "../config";
import { ACTOR, ALIVE, indexInsert } from "../ecs/storage";
import { type ActionEntry, KIND_CODE } from "../engine";
import { END } from "../space/grid";
import { validTarget } from "../turns/target";

export const OK = 0;
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
const UNKNOWN_BITS = 25;
const TWO_ACTORS = 26;
const UNKNOWN_INTENT = 19;
const INTENT_TARGET = 20;
const DEAD_VALUE = 21;
const IDLE_NEXT_AT = 22;
const IDLE_INTENT = 23;
const ABSENT_VALUE = 24;

// The slot and the value a failed check reports: plain numbers, so the hot loops close over nothing.
const problem = new Int32Array(2);
// checkLive leaves the live count here for checkLists.
const tally = new Int32Array(1);
const report = (code: number, slot: number, value: number) => {
	problem[0] = slot;
	problem[1] = value;
	return code;
};

export function describe(code: number): string {
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
		case UNKNOWN_INTENT:
			return `slot ${slot} intends unknown action ${value}`;
		case INTENT_TARGET:
			return `slot ${slot} intends target ${value}, which its action cannot take`;
		case IDLE_NEXT_AT:
			return `slot ${slot} does not act but next acts at ${value}`;
		case IDLE_INTENT:
			return `slot ${slot} does not act but intends action ${value}`;
		case ABSENT_VALUE:
			return `slot ${slot} keeps a value in component ${value}, a component it does not have`;
		case DEAD_VALUE:
			return `dead slot ${slot} keeps a value in saved column ${value}`;
		case UNKNOWN_BITS:
			return `slot ${slot} has unknown mask bits in word ${value}`;
		case TWO_ACTORS:
			return `cell ${value} holds two actors, the second in slot ${slot}`;
		default:
			return `${value} live slots are in no cell list`;
	}
}

export interface Rows {
	readonly base: number;
	readonly highWater: number;
	readonly maskWords: number;
	readonly ids: Int32Array;
	readonly masks: Int32Array;
	readonly cellOf: Int32Array;
	readonly next: Int32Array;
	readonly prev: Int32Array;
	// Per mask word, the bits a registered component or core tag may set.
	readonly known: Int32Array;
	readonly intentKey: Int32Array;
	readonly intentTarget: Int32Array;
}

export function checkFree(
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

export function checkLive(
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
		for (let w = 0; w < maskWords; w++)
			if (((masks[row * maskWords + w] ?? 0) & ~(rows.known[w] ?? 0)) !== 0)
				return report(UNKNOWN_BITS, slot, w);
		const id = ids[row] ?? 0;
		const serial = id - firstId;
		if (!(serial >= 1 && serial <= counter))
			return report(FOREIGN_ID, slot, id);
		if (!indexInsert(index, 0, ids, base, id, slot))
			return report(SHARED_ID, slot, id);
		const due = nextAt[row] ?? 0;
		if ((mask & ACTOR) !== 0) {
			if (!(due >= now && due <= MAX_TICK)) return report(NEXT_AT, slot, due);
		} else if (due !== 0) return report(IDLE_NEXT_AT, slot, due);
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
export function checkLists(
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
		let actors = 0;
		let slot = heads[cell] ?? END;
		while (slot !== END) {
			const row = slot - base;
			if (!(row >= 0 && row < highWater))
				return report(LIST_OUTSIDE, slot, cell);
			const mask = masks[row * maskWords] ?? 0;
			if ((mask & ALIVE) === 0) return report(LIST_DEAD, slot, cell);
			if ((mask & ACTOR) !== 0 && ++actors > 1)
				return report(TWO_ACTORS, slot, cell);
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

// A pass of its own: folded into checkLive's loop it measured four times slower.
// Rows mostly repeat one key, so only a key unlike the previous one searches the actions.
export function checkIntent(
	rows: Rows,
	cells: number,
	floors: number,
	actions: readonly ActionEntry[],
): number {
	const { base, highWater, maskWords, masks, intentKey, intentTarget } = rows;
	let known = 0;
	let knownKind = KIND_CODE.none;
	for (let row = 0; row < highWater; row++) {
		const key = intentKey[row] ?? 0;
		const target = intentTarget[row] ?? 0;
		if (key === 0) {
			if (target !== 0) return report(INTENT_TARGET, base + row, target);
			continue;
		}
		if (((masks[row * maskWords] ?? 0) & ACTOR) === 0)
			return report(IDLE_INTENT, base + row, key);
		if (key !== known) {
			let a = 0;
			while (
				a < actions.length &&
				((actions[a] as ActionEntry).key | 0) !== key
			)
				a++;
			if (a === actions.length) return report(UNKNOWN_INTENT, base + row, key);
			known = key;
			knownKind = (actions[a] as ActionEntry).kind;
		}
		if (!validTarget(knownKind, target, cells, floors))
			return report(INTENT_TARGET, base + row, target);
	}
	return OK;
}

// Columns grouped by width, so each inner loop reads one array kind.
export interface Component {
	readonly word: number;
	readonly bit: number;
	readonly bytes: readonly Int8Array[];
	readonly shorts: readonly Int16Array[];
	readonly words: readonly Int32Array[];
}

// Spawning sets a component's bit with its values, so a row without the bit holds only zeros.
export function checkAbsent(
	rows: Rows,
	components: readonly Component[],
): number {
	const { base, highWater, maskWords, masks } = rows;
	for (let c = 0; c < components.length; c++) {
		const { word, bit, bytes, shorts, words } = components[c] as Component;
		for (let row = 0; row < highWater; row++) {
			if (((masks[row * maskWords + word] ?? 0) & bit) !== 0) continue;
			for (let f = 0; f < bytes.length; f++)
				if ((bytes[f] as Int8Array)[row] !== 0)
					return report(ABSENT_VALUE, base + row, c);
			for (let f = 0; f < shorts.length; f++)
				if ((shorts[f] as Int16Array)[row] !== 0)
					return report(ABSENT_VALUE, base + row, c);
			for (let f = 0; f < words.length; f++)
				if ((words[f] as Int32Array)[row] !== 0)
					return report(ABSENT_VALUE, base + row, c);
		}
	}
	return OK;
}

// Recycling zeroes every column, so any value left on a freed row is corruption.
export function checkDead(
	rows: Rows,
	free: Int32Array,
	freeCount: number,
	columns: readonly (Int8Array | Int16Array | Int32Array)[],
): number {
	for (let c = 0; c < columns.length; c++) {
		const column = columns[c] as Int8Array | Int16Array | Int32Array;
		for (let i = 0; i < freeCount; i++) {
			const slot = free[i] ?? 0;
			if (column[slot - rows.base] !== 0) return report(DEAD_VALUE, slot, c);
		}
	}
	return OK;
}
