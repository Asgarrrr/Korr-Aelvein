import { CAP } from "../config";
import type { Column } from "../ecs/schema";
import type { Engine } from "../engine";
import type { Checksum } from "./checksum";

export const FORMAT_VERSION = 3;
export const WORD = 4;
export const VERSION = 0;
export const FINGERPRINT = 1;
export const FLOOR = 2;
export const COUNTER = 3;
export const HIGH_WATER = 4;
export const FREE_COUNT = 5;
export const TIME = 6;
export const SUM = 7;
export const FLOOR_HEADER = 9;
const BYTE_BITS = 8;

export const FREE = 0;
export const ROWS = 1;
export const MASKS = 2;
export const CELLS = 3;

export interface Section {
	readonly array: Column;
	// The same buffer seen as words, so hash and save never build a view per call.
	readonly words: Int32Array;
	readonly unit: number;
	readonly kind: number;
}

// Save, load, size and hash all walk this one list, so they cannot drift apart.
export function sectionsOf(engine: Engine): Section[] {
	const { storage, grid } = engine;
	const of = (array: Column, kind: number): Section => ({
		array,
		words: new Int32Array(
			array.buffer,
			array.byteOffset,
			array.byteLength / WORD,
		),
		unit: array.BYTES_PER_ELEMENT,
		kind,
	});
	return [
		of(storage.free, FREE),
		...storage.columns.map((column) => of(column, ROWS)),
		of(storage.masks, MASKS),
		of(grid.heads, CELLS),
	];
}

export function sectionStart(
	engine: Engine,
	section: Section,
	floor: number,
): number {
	if (section.kind === MASKS) return floor * CAP * engine.storage.maskWords;
	if (section.kind === CELLS) return floor * engine.grid.cells;
	return floor * CAP;
}

export function sectionCount(
	engine: Engine,
	section: Section,
	highWater: number,
	freeCount: number,
): number {
	if (section.kind === FREE) return freeCount;
	if (section.kind === ROWS) return highWater;
	if (section.kind === MASKS) return highWater * engine.storage.maskWords;
	return engine.grid.cells;
}

// Keeps the first `bytes` bytes of a little-endian word: an image pads every section with zeros.
export const tailMask = (bytes: number) => (1 << (bytes * BYTE_BITS)) - 1;

export function imageWords(
	engine: Engine,
	highWater: number,
	freeCount: number,
): number {
	const sections = engine.sections;
	let words = FLOOR_HEADER;
	for (let i = 0; i < sections.length; i++) {
		const section = sections[i] as Section;
		const bytes =
			sectionCount(engine, section, highWater, freeCount) * section.unit;
		words += Math.ceil(bytes / WORD);
	}
	return words;
}

// Folds the floor exactly as its image reads, minus the checksum words, into engine.floorSums.
export function floorChecksum(engine: Engine, floor: number): void {
	const { storage, sections, sum } = engine;
	const highWater = storage.highWater[floor] ?? 0;
	const freeCount = storage.freeCount[floor] ?? 0;
	sum.reset();
	sum.word(FORMAT_VERSION);
	sum.word(engine.fingerprint);
	sum.word(floor);
	sum.word(storage.counters[floor] ?? 0);
	sum.word(highWater);
	sum.word(freeCount);
	sum.word(engine.now[floor] ?? 0);
	for (let i = 0; i < sections.length; i++) {
		const section = sections[i] as Section;
		const bytes =
			sectionCount(engine, section, highWater, freeCount) * section.unit;
		const start = (sectionStart(engine, section, floor) * section.unit) / WORD;
		const whole = bytes >> 2;
		sum.words(section.words, start, whole);
		const tail = bytes & (WORD - 1);
		if (tail !== 0)
			sum.word((section.words[start + whole] ?? 0) & tailMask(tail));
	}
	sum.digest(engine.floorSums, floor * 2);
}

export function imageChecksum(
	sum: Checksum,
	words: Int32Array,
	out: Int32Array,
): void {
	sum.reset();
	sum.words(words, 0, SUM);
	sum.words(words, FLOOR_HEADER, words.length - FLOOR_HEADER);
	sum.digest(out, 0);
}

// Expects engine.floorSums to be current for this floor; returns the word after the image.
export function writeFloor(
	engine: Engine,
	floor: number,
	out: Int32Array,
	at: number,
): number {
	const { storage, sections } = engine;
	const highWater = storage.highWater[floor] ?? 0;
	const freeCount = storage.freeCount[floor] ?? 0;
	out[at + VERSION] = FORMAT_VERSION;
	out[at + FINGERPRINT] = engine.fingerprint;
	out[at + FLOOR] = floor;
	out[at + COUNTER] = storage.counters[floor] ?? 0;
	out[at + HIGH_WATER] = highWater;
	out[at + FREE_COUNT] = freeCount;
	out[at + TIME] = engine.now[floor] ?? 0;
	out[at + SUM] = engine.floorSums[floor * 2] ?? 0;
	out[at + SUM + 1] = engine.floorSums[floor * 2 + 1] ?? 0;
	let w = at + FLOOR_HEADER;
	for (let i = 0; i < sections.length; i++) {
		const section = sections[i] as Section;
		const src = section.words;
		const bytes =
			sectionCount(engine, section, highWater, freeCount) * section.unit;
		const start = (sectionStart(engine, section, floor) * section.unit) / WORD;
		const whole = bytes >> 2;
		for (let j = 0; j < whole; j++) out[w + j] = src[start + j] ?? 0;
		w += whole;
		const tail = bytes & (WORD - 1);
		if (tail !== 0) out[w++] = (src[start + whole] ?? 0) & tailMask(tail);
	}
	return w;
}

export function saveFloor(engine: Engine, floor: number): Uint8Array {
	const { highWater, freeCount } = engine.storage;
	const out = new Int32Array(
		imageWords(engine, highWater[floor] ?? 0, freeCount[floor] ?? 0),
	);
	floorChecksum(engine, floor);
	writeFloor(engine, floor, out, 0);
	return new Uint8Array(out.buffer);
}

// Expects an image that passed checkFloor, the index that check built, and a floor that never held an entity.
export function readFloor(
	engine: Engine,
	image: Uint8Array,
	index: Int32Array,
): void {
	const words = new Int32Array(
		image.buffer,
		image.byteOffset,
		image.length / WORD,
	);
	const floor = words[FLOOR] ?? 0;
	const highWater = words[HIGH_WATER] ?? 0;
	const freeCount = words[FREE_COUNT] ?? 0;
	const { storage, scheduler, sections } = engine;
	storage.counters[floor] = words[COUNTER] ?? 0;
	storage.highWater[floor] = highWater;
	storage.freeCount[floor] = freeCount;
	engine.now[floor] = words[TIME] ?? 0;
	let w = FLOOR_HEADER;
	for (let i = 0; i < sections.length; i++) {
		const section = sections[i] as Section;
		const bytes =
			sectionCount(engine, section, highWater, freeCount) * section.unit;
		const start = (sectionStart(engine, section, floor) * section.unit) / WORD;
		const whole = bytes >> 2;
		section.words.set(words.subarray(w, w + whole), start);
		w += whole;
		const tail = bytes & (WORD - 1);
		if (tail !== 0) {
			const mask = tailMask(tail);
			const kept = (section.words[start + whole] ?? 0) & ~mask;
			section.words[start + whole] = kept | ((words[w++] ?? 0) & mask);
		}
	}
	storage.adoptIndex(floor, index);
	scheduler.rebuild(floor);
}
