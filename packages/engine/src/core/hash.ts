import type { Checksum } from "./checksum";
import type { Engine } from "./engine";
import { floorChecksum } from "./image";

const HEX = 16;
const HEX_DIGITS = 8;

export interface WorldFields {
	readonly seed: number;
	readonly round: number;
	readonly floors: number;
	readonly width: number;
	readonly height: number;
	readonly popCap: number;
}

export function worldDigest(
	sum: Checksum,
	world: WorldFields,
	switches: ArrayLike<number>,
	floorSums: ArrayLike<number>,
	out: Int32Array,
): void {
	sum.reset();
	sum.word(world.seed);
	sum.word(world.round);
	sum.word(world.floors);
	sum.word(world.width);
	sum.word(world.height);
	sum.word(world.popCap);
	for (let f = 0; f < world.floors; f++) sum.word(switches[f] ?? 0);
	for (let i = 0; i < 2 * world.floors; i++) sum.word(floorSums[i] ?? 0);
	sum.digest(out, 0);
}

// Leaves every floor's checksum in engine.floorSums and the world's in engine.digest.
export function engineDigest(engine: Engine): void {
	for (let f = 0; f < engine.storage.floors; f++) floorChecksum(engine, f);
	engine.shape.round = engine.round;
	worldDigest(
		engine.sum,
		engine.shape,
		engine.events.enabled,
		engine.floorSums,
		engine.digest,
	);
}

export function hashHex(digest: Int32Array): string {
	const hex = (v: number) => (v >>> 0).toString(HEX).padStart(HEX_DIGITS, "0");
	return hex(digest[0] ?? 0) + hex(digest[1] ?? 0);
}
