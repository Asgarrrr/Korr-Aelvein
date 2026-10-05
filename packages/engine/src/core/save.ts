import { MAX_FLOORS, MAX_TICK, TICKS_PER_TURN } from "./config";
import type { Engine } from "./engine";
import { engineDigest, type WorldFields } from "./hash";
import { FORMAT_VERSION, imageWords, WORD, writeFloor } from "./image";
import { checkVersion } from "./validate";

const VERSION = 0;
const HASH_A = 1;
const HASH_B = 2;
const SEED = 3;
const ROUND = 4;
const FLOORS = 5;
const WIDTH = 6;
const HEIGHT = 7;
const POP_CAP = 8;
// Then, per floor, its event switch, then per floor its image length in bytes.
const WORLD_HEADER = 9;

export interface WorldHeader extends WorldFields {
	readonly events: readonly number[];
}

export interface SavedWorld {
	readonly header: WorldHeader;
	readonly hash: readonly [number, number];
	readonly images: readonly Uint8Array[];
}

export function saveWorld(engine: Engine): Uint8Array {
	const { storage, grid, events } = engine;
	const floors = storage.floors;
	const header = WORLD_HEADER + 2 * floors;
	let total = header;
	for (let f = 0; f < floors; f++)
		total += imageWords(
			engine,
			storage.highWater[f] ?? 0,
			storage.freeCount[f] ?? 0,
		);
	const out = new Int32Array(total);
	engineDigest(engine);
	out[VERSION] = FORMAT_VERSION;
	out[HASH_A] = engine.digest[0] ?? 0;
	out[HASH_B] = engine.digest[1] ?? 0;
	out[SEED] = engine.seed;
	out[ROUND] = engine.round;
	out[FLOORS] = floors;
	out[WIDTH] = grid.width;
	out[HEIGHT] = grid.height;
	out[POP_CAP] = engine.popCap;
	let at = header;
	for (let f = 0; f < floors; f++) {
		out[WORLD_HEADER + f] = events.enabled[f] ?? 0;
		const end = writeFloor(engine, f, out, at);
		out[WORLD_HEADER + floors + f] = (end - at) * WORD;
		at = end;
	}
	return new Uint8Array(out.buffer);
}

// Checks the file's framing only; floor contents are checked against the world they load into.
export function readWorld(input: Uint8Array): SavedWorld {
	const bytes = input.byteOffset % WORD === 0 ? input : input.slice();
	const fail = (why: string): never => {
		throw new Error(`save file: ${why}`);
	};
	if (bytes.length % WORD !== 0 || bytes.length < WORLD_HEADER * WORD)
		fail(`${bytes.length} bytes is not a world header`);
	const head = new Int32Array(bytes.buffer, bytes.byteOffset, WORLD_HEADER);
	checkVersion(head[VERSION]);
	const floors = head[FLOORS] ?? 0;
	if (!(floors >= 1 && floors <= MAX_FLOORS)) fail(`${floors} floors`);
	const round = head[ROUND] ?? 0;
	if (!(round >= 0 && round * TICKS_PER_TURN <= MAX_TICK))
		fail(`round ${round}`);
	const words = WORLD_HEADER + 2 * floors;
	if (bytes.length < words * WORD) fail("truncated floor table");
	const table = new Int32Array(bytes.buffer, bytes.byteOffset, words);
	const events: number[] = [];
	const images: Uint8Array[] = [];
	let at = words * WORD;
	for (let f = 0; f < floors; f++) {
		const on = table[WORLD_HEADER + f] ?? 0;
		if (on !== 0 && on !== 1) fail(`floor ${f} event switch is ${on}`);
		events.push(on);
		const length = table[WORLD_HEADER + floors + f] ?? 0;
		if (!(length >= 0 && length % WORD === 0 && at + length <= bytes.length))
			fail(`floor ${f} image length ${length}`);
		images.push(bytes.subarray(at, at + length));
		at += length;
	}
	if (at !== bytes.length) fail(`${bytes.length - at} trailing bytes`);
	return {
		header: {
			seed: (head[SEED] ?? 0) >>> 0,
			round,
			floors,
			width: head[WIDTH] ?? 0,
			height: head[HEIGHT] ?? 0,
			popCap: head[POP_CAP] ?? 0,
			events,
		},
		hash: [head[HASH_A] ?? 0, head[HASH_B] ?? 0],
		images,
	};
}
