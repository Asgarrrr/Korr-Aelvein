import { CAP, TICKS_PER_TURN } from "../config";
import type { Column } from "../ecs/schema";
import { type Engine, FLOOR_STAGE } from "../engine";
import type { Checksum } from "./checksum";

export const FORMAT_VERSION = 6;
export const WORD = 4;
export const VERSION = 0;
export const FINGERPRINT = 1;
export const FLOOR = 2;
export const COUNTER = 3;
export const HIGH_WATER = 4;
export const FREE_COUNT = 5;
export const TIME = 6;
export const STAGE = 7;
export const PERIOD = 8;
export const INBOX = 9;
export const TRAFFIC = 10;
export const EMITTED = 11;
export const SUM = 12;
// Then the sections, then the inbox entries.
export const FLOOR_HEADER = 14;
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
	// Elements between one floor's slice and the next.
	readonly stride: number;
}

// Save, load, size and hash all walk this one list, so they cannot drift apart.
export function sectionsOf(engine: Engine): Section[] {
	const { storage, grid } = engine;
	const of = (array: Column, kind: number, stride: number): Section => ({
		array,
		words: new Int32Array(
			array.buffer,
			array.byteOffset,
			array.byteLength / WORD,
		),
		unit: array.BYTES_PER_ELEMENT,
		kind,
		stride,
	});
	const cellColumns = [...engine.cellColumns.values()].flatMap((columns) =>
		Object.values(columns),
	);
	return [
		of(storage.free, FREE, CAP),
		...storage.columns.map((column) => of(column, ROWS, CAP)),
		of(storage.masks, MASKS, CAP * storage.maskWords),
		of(grid.heads, CELLS, grid.cells),
		...cellColumns.map((column) => of(column, CELLS, grid.stride)),
	];
}

export function sectionStart(
	_engine: Engine,
	section: Section,
	floor: number,
): number {
	return floor * section.stride;
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
	inbox: number,
): number {
	const sections = engine.sections;
	let words = FLOOR_HEADER + inbox * engine.inbox.width;
	for (let i = 0; i < sections.length; i++) {
		const section = sections[i] as Section;
		const bytes =
			sectionCount(engine, section, highWater, freeCount) * section.unit;
		words += Math.ceil(bytes / WORD);
	}
	return words;
}

export interface FloorHeader {
	readonly version: number;
	readonly fingerprint: number;
	readonly floor: number;
	readonly counter: number;
	readonly highWater: number;
	readonly freeCount: number;
	readonly time: number;
	readonly stage: number;
	readonly period: number;
	readonly inbox: number;
	readonly traffic: number;
	readonly emitted: number;
}

// The header words before the checksum.
export function writeHeader(
	engine: Engine,
	floor: number,
	out: Int32Array,
	at: number,
): void {
	const { storage } = engine;
	out[at + VERSION] = FORMAT_VERSION;
	out[at + FINGERPRINT] = engine.fingerprint;
	out[at + FLOOR] = floor;
	out[at + COUNTER] = storage.counters[floor] ?? 0;
	out[at + HIGH_WATER] = storage.highWater[floor] ?? 0;
	out[at + FREE_COUNT] = storage.freeCount[floor] ?? 0;
	out[at + TIME] = engine.now[floor] ?? 0;
	out[at + STAGE] = engine.stage[floor] ?? 0;
	out[at + PERIOD] = engine.period[floor] ?? 0;
	out[at + INBOX] = engine.inbox.count(floor);
	out[at + TRAFFIC] = engine.traffic[floor] ?? 0;
	out[at + EMITTED] = engine.events.emittedThisTurn(floor);
}

// Expects at least FLOOR_HEADER words.
export function readHeader(words: Int32Array): FloorHeader {
	return {
		version: words[VERSION] ?? 0,
		fingerprint: words[FINGERPRINT] ?? 0,
		floor: words[FLOOR] ?? 0,
		counter: words[COUNTER] ?? 0,
		highWater: words[HIGH_WATER] ?? 0,
		freeCount: words[FREE_COUNT] ?? 0,
		time: words[TIME] ?? 0,
		stage: words[STAGE] ?? 0,
		period: words[PERIOD] ?? 0,
		inbox: words[INBOX] ?? 0,
		traffic: words[TRAFFIC] ?? 0,
		emitted: words[EMITTED] ?? 0,
	};
}

// Folds the floor exactly as its image reads, minus the checksum words, into engine.floorSums.
// Without the inbox, it covers only what the floor's own round may change.
export function floorChecksum(
	engine: Engine,
	floor: number,
	withInbox = true,
): void {
	const { storage, sections, sum, inbox, header } = engine;
	if (engine.harms.count !== 0)
		throw new Error("a snapshot was taken with harm still pending");
	const highWater = storage.highWater[floor] ?? 0;
	const freeCount = storage.freeCount[floor] ?? 0;
	writeHeader(engine, floor, header, 0);
	if (!withInbox) {
		header[INBOX] = 0;
		header[TRAFFIC] = 0;
	}
	const entries = header[INBOX] ?? 0;
	sum.reset();
	sum.words(header, 0, SUM);
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
	sum.words(inbox.words(floor), 0, entries * inbox.width);
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

// Returns the word after the image. With `sum`, folds each section into it right after its
// copy, while it is still in cache; without, expects engine.floorSums current for this floor.
export function writeFloor(
	engine: Engine,
	floor: number,
	out: Int32Array,
	at: number,
	sum?: Checksum,
): number {
	const { storage, sections } = engine;
	const highWater = storage.highWater[floor] ?? 0;
	const freeCount = storage.freeCount[floor] ?? 0;
	writeHeader(engine, floor, out, at);
	const entries = out[at + INBOX] ?? 0;
	sum?.reset();
	sum?.words(out, at, SUM);
	let w = at + FLOOR_HEADER;
	for (let i = 0; i < sections.length; i++) {
		const section = sections[i] as Section;
		const src = section.words;
		const bytes =
			sectionCount(engine, section, highWater, freeCount) * section.unit;
		const start = (sectionStart(engine, section, floor) * section.unit) / WORD;
		const whole = bytes >> 2;
		out.set(src.subarray(start, start + whole), w);
		const tail = bytes & (WORD - 1);
		if (tail !== 0) out[w + whole] = (src[start + whole] ?? 0) & tailMask(tail);
		const written = whole + (tail === 0 ? 0 : 1);
		sum?.words(out, w, written);
		w += written;
	}
	const length = entries * engine.inbox.width;
	out.set(engine.inbox.words(floor).subarray(0, length), w);
	if (sum) {
		sum.words(out, w, length);
		sum.digest(out, at + SUM);
	} else {
		out[at + SUM] = engine.floorSums[floor * 2] ?? 0;
		out[at + SUM + 1] = engine.floorSums[floor * 2 + 1] ?? 0;
	}
	return w + length;
}

// Writes into `into` when it is word-aligned and large enough; a server reusing one buffer per
// floor skips the page faults of a fresh one, the larger half of a snapshot's cost.
export function saveFloor(
	engine: Engine,
	floor: number,
	into?: Uint8Array,
): Uint8Array {
	if (engine.harms.count !== 0)
		throw new Error("a snapshot was taken with harm still pending");
	const { highWater, freeCount } = engine.storage;
	const words = imageWords(
		engine,
		highWater[floor] ?? 0,
		freeCount[floor] ?? 0,
		engine.inbox.count(floor),
	);
	const reuse =
		into !== undefined &&
		into.byteOffset % WORD === 0 &&
		into.length >= words * WORD;
	const out = reuse
		? new Int32Array(into.buffer, into.byteOffset, words)
		: new Int32Array(words);
	writeFloor(engine, floor, out, 0, engine.sum);
	return new Uint8Array(out.buffer, out.byteOffset, words * WORD);
}

// Expects an image that passed checkFloor, and the index and player count that check found.
export function readFloor(
	engine: Engine,
	image: Uint8Array,
	index: Int32Array,
	players: number,
): void {
	const words = new Int32Array(
		image.buffer,
		image.byteOffset,
		image.length / WORD,
	);
	const head = readHeader(words);
	const { floor, highWater, freeCount } = head;
	const { storage, scheduler, sections } = engine;
	clearRows(engine, floor, highWater);
	storage.counters[floor] = head.counter;
	storage.highWater[floor] = highWater;
	storage.freeCount[floor] = freeCount;
	engine.now[floor] = head.time;
	engine.stage[floor] = head.stage;
	engine.period[floor] = head.period;
	engine.traffic[floor] = head.traffic;
	engine.events.resumeTurn(floor, head.emitted);
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
	const entries = head.inbox;
	engine.inbox.replace(
		floor,
		words.subarray(w, w + entries * engine.inbox.width),
		entries,
	);
	storage.adoptIndex(floor, index);
	// A floor mid-round resumes its round; any other has none open until it starts the next.
	const now = engine.now[floor] ?? 0;
	scheduler.rebuild(
		floor,
		engine.stage[floor] === FLOOR_STAGE.acting
			? (Math.floor(now / TICKS_PER_TURN) + 1) * TICKS_PER_TURN
			: now,
	);
	engine.players[floor] = players;
}

// The section copy rewrites every row below the incoming high water; rows above it must go.
function clearRows(engine: Engine, floor: number, highWater: number): void {
	const { storage } = engine;
	const from = floor * CAP + highWater;
	const to = floor * CAP + (storage.highWater[floor] ?? 0);
	if (from >= to) return;
	for (const column of storage.columns) column.fill(0, from, to);
	storage.masks.fill(0, from * storage.maskWords, to * storage.maskWords);
}
