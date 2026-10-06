import type { Slot } from "./ids";
import type { MaskBit, Storage } from "./storage";

export class MaskBits {
	readonly words: Int32Array;
	readonly bits: Int32Array;
	readonly #storage: Storage;

	constructor(storage: Storage, required: readonly MaskBit[]) {
		this.#storage = storage;
		const byWord = new Map<number, number>();
		for (const { word, bit } of required)
			byWord.set(word, (byWord.get(word) ?? 0) | bit);
		const words = [...byWord.keys()].sort((a, b) => a - b);
		this.words = Int32Array.from(words);
		this.bits = Int32Array.from(words, (w) => byWord.get(w) ?? 0);
	}

	has(slot: Slot): boolean {
		const masks = this.#storage.masks;
		const base = slot * this.#storage.maskWords;
		const words = this.words;
		const bits = this.bits;
		for (let k = 0; k < words.length; k++) {
			const bit = bits[k] ?? 0;
			if (((masks[base + (words[k] ?? 0)] ?? 0) & bit) !== bit) return false;
		}
		return true;
	}
}

Object.freeze(MaskBits.prototype);
