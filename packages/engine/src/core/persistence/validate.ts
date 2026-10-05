import {
	CAP,
	EVENT_CAP_PER_TURN,
	ID_FLOOR_STRIDE,
	LOD_PERIODS,
	MAX_TICK,
	TICKS_PER_TURN,
} from "../config";
import { ACTOR, ALIVE, indexInsert, knownBits, PLAYER } from "../ecs/storage";
import { type Engine, FLOOR_STAGE } from "../engine";
import { END } from "../space/grid";
import { validLink } from "../travel/link";
import {
	COUNTER,
	EMITTED,
	FINGERPRINT,
	FLOOR,
	FLOOR_HEADER,
	FORMAT_VERSION,
	FREE_COUNT,
	HIGH_WATER,
	INBOX,
	imageChecksum,
	imageWords,
	PERIOD,
	ROWS,
	readFloor,
	type Section,
	STAGE,
	SUM,
	sectionCount,
	TIME,
	TRAFFIC,
	tailMask,
	VERSION,
	WORD,
} from "./image";
import { inboxProblem } from "./inbox";
import {
	checkAbsent,
	checkDead,
	checkFree,
	checkIntent,
	checkLinks,
	checkLists,
	checkLive,
	checkVitality,
	describe,
	type Links,
	OK,
	playersSeen,
	type Rows,
} from "./rows";

export function checkVersion(version: number | undefined): void {
	if (version !== FORMAT_VERSION)
		throw new Error(
			`image format version ${version}, expected ${FORMAT_VERSION}`,
		);
}

const sums = new Int32Array(2);

// "fast" stops after the header, framing and checksum; "full" also checks every row and inbox entry.
export type LoadCheck = "fast" | "full";

// Reads only the image: a bad one throws before any engine state changes.
// Fills `index` with the floor's id index, which readFloor then adopts, and returns how many
// players stand on the floor.
export function checkFloor(
	engine: Engine,
	image: Uint8Array,
	floor: number,
	round: number,
	index: Int32Array,
	check: LoadCheck,
): number {
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
	const stage = words[STAGE] ?? 0;
	const period = words[PERIOD] ?? 0;
	const entries = words[INBOX] ?? 0;
	// Arrivals ignore popCap, so only CAP bounds the rows.
	if (!(freeCount >= 0 && freeCount <= highWater && highWater <= CAP))
		fail(`free count ${freeCount}, high water ${highWater}`);
	if (!(counter >= 0 && counter < ID_FLOOR_STRIDE))
		fail(`id counter ${counter}`);
	const start = round * TICKS_PER_TURN;
	const end = start + TICKS_PER_TURN;
	const timed =
		stage === FLOOR_STAGE.waiting
			? now === start && period === 0
			: LOD_PERIODS.includes(period) &&
				(stage === FLOOR_STAGE.acting
					? now >= start && now < end
					: now === end);
	if (!timed)
		fail(
			`time ${now}, stage ${stage}, period ${period} do not fit round ${round}`,
		);
	// Waiting arrivals pile up without bound on a full floor: only the image's length bounds them.
	if (
		!(
			entries >= 0 &&
			entries * engine.inbox.width <= words.length - FLOOR_HEADER
		)
	)
		fail(`${entries} inbox entries`);
	const emitted = words[EMITTED] ?? 0;
	if (!(emitted >= 0 && emitted <= EVENT_CAP_PER_TURN))
		fail(`${emitted} events this turn`);
	const expected = imageWords(engine, highWater, freeCount, entries);
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
	const uint8 = (array: unknown) => {
		const view = at.get(array) ?? { at: 0, count: 0 };
		return new Uint8Array(image.buffer, view.at, view.count);
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
	if (check === "fast")
		return indexRows(
			rows,
			index,
			{
				free: int32(storage.free),
				freeCount,
				nextAt: int32(scheduler.nextAt),
				now,
				heads: int32(grid.heads),
				cells: grid.cells,
				links: {
					word: engine.link.word,
					bit: engine.link.bit,
					floor: uint8(engine.link.floor),
					x: int16(engine.link.x),
					y: int16(engine.link.y),
				},
				floor,
				floors: storage.floors,
				width: grid.width,
				height: grid.height,
			},
			fail,
		);
	const code =
		checkFree(rows, int32(storage.free), freeCount, engine.checkFreed) ||
		checkLive(
			rows,
			engine.checkFreed,
			index,
			floor,
			storage.floors,
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
		checkLinks(
			rows,
			{
				word: engine.link.word,
				bit: engine.link.bit,
				floor: uint8(engine.link.floor),
				x: int16(engine.link.x),
				y: int16(engine.link.y),
			},
			floor,
			storage.floors,
			grid.width,
			grid.height,
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
	const problem = inboxProblem(
		engine,
		words.subarray(w, w + entries * engine.inbox.width),
		entries,
		{ index, ids: rows.ids, base: rows.base },
	);
	if (problem !== undefined) fail(problem);
	return playersSeen();
}

// The id index readFloor adopts, and the player count; a repeated id would leave a row no id reaches.
// Beyond unique ids, the fast check guarantees only that every slot and cell the engine will
// index is on this floor (free list, cell heads, grid links, cells), that live actors are due in
// [now, MAX_TICK], and that stairs lead to another floor's cell. Other row values go unchecked.
function indexRows(
	rows: Rows,
	index: Int32Array,
	guard: {
		readonly free: Int32Array;
		readonly freeCount: number;
		readonly nextAt: Int32Array;
		readonly now: number;
		readonly heads: Int32Array;
		readonly cells: number;
		readonly links: Links;
		readonly floor: number;
		readonly floors: number;
		readonly width: number;
		readonly height: number;
	},
	fail: (why: string) => never,
): number {
	const { base, highWater, maskWords, ids, masks, cellOf, next, prev } = rows;
	const { free, freeCount, nextAt, now, heads, cells, links } = guard;
	// Most worlds keep the link bit in the first mask word, which the loop has already read.
	const linkInFirst = links.word === 0;
	// One unsigned compare per range: below base wraps past highWater.
	for (let i = 0; i < freeCount; i++) {
		const slot = free[i] ?? 0;
		if (!((slot - base) >>> 0 < highWater))
			fail(`free slot ${slot} out of range`);
	}
	for (let c = 0; c < cells; c++) {
		const slot = heads[c] ?? END;
		if (!((slot - base) >>> 0 < highWater || slot === END))
			fail(`cell ${c} lists slot ${slot}, outside this floor`);
	}
	index.fill(0);
	let players = 0;
	for (let row = 0; row < highWater; row++) {
		const mask = masks[row * maskWords] ?? 0;
		if ((mask & ALIVE) === 0) continue;
		if ((mask & PLAYER) !== 0) players++;
		const id = ids[row] ?? 0;
		if (!indexInsert(index, 0, ids, base, id, base + row))
			fail(`id ${id} is held by two slots`);
		const cell = cellOf[row] ?? 0;
		if (!(cell >>> 0 < cells))
			fail(`slot ${base + row} sits in cell ${cell}, off the floor`);
		const due = nextAt[row] ?? 0;
		if ((mask & ACTOR) !== 0 && !(due >= now && due <= MAX_TICK))
			fail(`actor in slot ${base + row} next acts at ${due}`);
		const after = next[row] ?? END;
		const before = prev[row] ?? END;
		if (!((after - base) >>> 0 < highWater || after === END))
			fail(`slot ${base + row} links to slot ${after}, outside this floor`);
		if (!((before - base) >>> 0 < highWater || before === END))
			fail(`slot ${base + row} links to slot ${before}, outside this floor`);
		const linkWord = linkInFirst
			? mask
			: (masks[row * maskWords + links.word] ?? 0);
		if (
			(linkWord & links.bit) !== 0 &&
			!validLink(
				guard.floor,
				links.floor[row] ?? 0,
				links.x[row] ?? 0,
				links.y[row] ?? 0,
				guard.floors,
				guard.width,
				guard.height,
			)
		)
			fail(
				`slot ${base + row} has a link to floor ${links.floor[row]} that leads nowhere`,
			);
	}
	return players;
}

// Into a live world, between rounds only, and only while no entity left or headed for the floor
// since the image: either would be duplicated or lost.
export function loadFloor(
	engine: Engine,
	image: Uint8Array,
	floor: number,
	check: LoadCheck = "full",
): void {
	if (!engine.stage.every((stage) => stage === FLOOR_STAGE.waiting))
		throw new Error(`floor ${floor} image: loads only at a round boundary`);
	const players = checkFloor(
		engine,
		image,
		floor,
		engine.round,
		engine.checkIndex,
		check,
	);
	const header = new Int32Array(image.buffer, image.byteOffset, FLOOR_HEADER);
	if (header[STAGE] !== FLOOR_STAGE.waiting)
		throw new Error(
			`floor ${floor} image: saved mid-round, loads only at a round boundary`,
		);
	if (header[TRAFFIC] !== engine.traffic[floor])
		throw new Error(
			`floor ${floor} image: traffic ${header[TRAFFIC]}, the live floor has ${engine.traffic[floor]}`,
		);
	readFloor(engine, image, engine.checkIndex, players);
}
