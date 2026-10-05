import { CAP } from "./config";
import type { Engine } from "./engine";
import { lowbias32 } from "./rng";

const LANE_A = 0x9e3779b1;
const LANE_B = 0x85ebca77;
const MUL_A = 0xcc9e2d51;
const MUL_B = 0x1b873593;
const ROTATE = 13;
const WORD_BITS = 32;
const HEX = 16;
const HEX_DIGITS = 8;

class Hasher {
	private a = LANE_A;
	private b = LANE_B;

	add(v: number): void {
		const a = Math.imul(this.a ^ v, MUL_A);
		this.a = (a << ROTATE) | (a >>> (WORD_BITS - ROTATE));
		const b = Math.imul((this.b + v) | 0, MUL_B);
		this.b = b ^ (b >>> 15);
	}

	addRange(values: ArrayLike<number>, from: number, to: number): void {
		for (let i = from; i < to; i++) this.add(values[i] ?? 0);
	}

	digest(): string {
		const a = lowbias32(this.a);
		const b = lowbias32(this.b ^ a);
		const hex = (v: number) => v.toString(HEX).padStart(HEX_DIGITS, "0");
		return hex(a) + hex(b);
	}
}

export function hashEngine(engine: Engine): string {
	const h = new Hasher();
	const { storage, grid, scheduler } = engine;
	h.add(engine.seed);
	h.add(engine.round);
	h.add(storage.floors);
	h.add(grid.width);
	h.add(grid.height);
	for (let f = 0; f < storage.floors; f++) {
		const base = f * CAP;
		const used = storage.highWater[f] ?? 0;
		const freed = storage.freeCount[f] ?? 0;
		h.add(engine.now[f] ?? 0);
		h.add(storage.counters[f] ?? 0);
		h.add(used);
		h.add(freed);
		h.add(scheduler.size(f));
		h.addRange(storage.free, base, base + freed);
		h.addRange(grid.heads, f * grid.cells, (f + 1) * grid.cells);
		for (const column of storage.columns) h.addRange(column, base, base + used);
		const words = storage.maskWords;
		h.addRange(storage.masks, base * words, (base + used) * words);
	}
	return h.digest();
}
