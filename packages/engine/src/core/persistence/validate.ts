import { CAP, ID_FLOOR_STRIDE, TICKS_PER_TURN } from "../config";
import { knownBits } from "../ecs/storage";
import type { Engine } from "../engine";
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
	ROWS,
	readFloor,
	type Section,
	SUM,
	sectionCount,
	TIME,
	tailMask,
	VERSION,
	WORD,
} from "./image";
import {
	checkAbsent,
	checkDead,
	checkFree,
	checkIntent,
	checkLists,
	checkLive,
	checkVitality,
	describe,
	OK,
	type Rows,
} from "./rows";

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
	const bySection = new Map(
		sections.map((section) => [section.array, section]),
	);
	const byUnit = (section: Section) => {
		const view = at.get(section.array) ?? { at: 0, count: 0 };
		if (section.unit === 1)
			return new Int8Array(image.buffer, view.at, view.count);
		if (section.unit === 2)
			return new Int16Array(image.buffer, view.at, view.count);
		return new Int32Array(image.buffer, view.at, view.count);
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
		intentKey: int32(engine.intentKey),
		intentTarget: int32(engine.intentTarget),
		known: knownBits(storage.maskWords, engine.components.size),
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
		checkLists(rows, int32(grid.heads), grid.cells, engine.checkListed) ||
		checkDead(
			rows,
			int32(storage.free),
			freeCount,
			sections.filter((s) => s.kind === ROWS).map(byUnit),
		) ||
		checkIntent(rows, grid.cells, storage.floors, engine.actions) ||
		checkVitality(
			rows,
			engine.vitality.word,
			engine.vitality.bit,
			int16(engine.vitality.hp),
			int16(engine.vitality.max),
		) ||
		checkAbsent(
			rows,
			[...engine.components.values()].map(({ bit, columns }) => {
				const views = Object.values(columns).map((column) =>
					byUnit(bySection.get(column) as Section),
				);
				return {
					word: bit.word,
					bit: bit.bit,
					bytes: views.filter((v) => v instanceof Int8Array),
					shorts: views.filter((v) => v instanceof Int16Array),
					words: views.filter((v) => v instanceof Int32Array),
				};
			}),
		);
	if (code !== OK) fail(describe(code));
}

export function loadFloor(
	engine: Engine,
	image: Uint8Array,
	floor: number,
): void {
	checkFloor(engine, image, floor, engine.round, engine.checkIndex);
	readFloor(engine, image, engine.checkIndex);
}
