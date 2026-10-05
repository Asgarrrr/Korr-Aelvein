import { CAP } from "../config";
import type { Slot } from "./ids";
import { ALIVE, type MaskBit, type Storage } from "./storage";

export interface SlotList {
	readonly length: number;
	at(i: number): Slot;
}

// Structural, so core/ecs needs no context type: the core passes its own contexts.
interface OnFloor {
	readonly floor: number;
}

export class MaskQuery implements SlotList {
	length = 0;
	readonly #list = new Int32Array(CAP);
	readonly #words: Int32Array;
	readonly #bits: Int32Array;
	readonly #storage: Storage;

	constructor(storage: Storage, required: readonly MaskBit[]) {
		this.#storage = storage;
		const byWord = new Map<number, number>([[0, ALIVE]]);
		for (const { word, bit } of required)
			byWord.set(word, (byWord.get(word) ?? 0) | bit);
		const words = [...byWord.keys()].sort((a, b) => a - b);
		this.#words = Int32Array.from(words);
		this.#bits = Int32Array.from(words, (w) => byWord.get(w) ?? 0);
	}

	has(slot: Slot): boolean {
		const masks = this.#storage.masks;
		const base = slot * this.#storage.maskWords;
		const words = this.#words;
		const bits = this.#bits;
		for (let k = 0; k < words.length; k++) {
			const bit = bits[k] ?? 0;
			if (((masks[base + (words[k] ?? 0)] ?? 0) & bit) !== bit) return false;
		}
		return true;
	}

	slots(ctx: OnFloor): SlotList {
		const floor = ctx.floor;
		const start = floor * CAP;
		const end = start + (this.#storage.highWater[floor] ?? 0);
		const list = this.#list;
		let n = 0;
		if (this.#words.length === 1) {
			const masks = this.#storage.masks;
			const stride = this.#storage.maskWords;
			const bit = this.#bits[0] ?? 0;
			for (let s = start; s < end; s++)
				if (((masks[s * stride] ?? 0) & bit) === bit) list[n++] = s;
		} else {
			for (let s = start; s < end; s++) if (this.has(s as Slot)) list[n++] = s;
		}
		this.length = n;
		return this;
	}

	at(i: number): Slot {
		return (this.#list[i] ?? 0) as Slot;
	}
}

Object.freeze(MaskQuery.prototype);
