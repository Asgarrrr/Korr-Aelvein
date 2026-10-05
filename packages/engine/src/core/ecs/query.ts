import { CAP } from "../config";
import type { Slot } from "./ids";
import { ALIVE, type MaskBit, type Storage } from "./storage";

export interface SlotList {
	readonly length: number;
	at(i: number): Slot;
}

export interface Query {
	has(slot: Slot): boolean;
	// Fills one list shared by every call: never nest two loops over the same query.
	slots(floor: number): SlotList;
}

export class MaskQuery implements Query, SlotList {
	length = 0;
	private readonly list = new Int32Array(CAP);
	private readonly words: Int32Array;
	private readonly bits: Int32Array;

	constructor(
		private readonly storage: Storage,
		required: readonly MaskBit[],
	) {
		const byWord = new Map<number, number>([[0, ALIVE]]);
		for (const { word, bit } of required)
			byWord.set(word, (byWord.get(word) ?? 0) | bit);
		const words = [...byWord.keys()].sort((a, b) => a - b);
		this.words = Int32Array.from(words);
		this.bits = Int32Array.from(words, (w) => byWord.get(w) ?? 0);
	}

	has(slot: Slot): boolean {
		const masks = this.storage.masks;
		const base = slot * this.storage.maskWords;
		const { words, bits } = this;
		for (let k = 0; k < words.length; k++) {
			const bit = bits[k] ?? 0;
			if (((masks[base + (words[k] ?? 0)] ?? 0) & bit) !== bit) return false;
		}
		return true;
	}

	slots(floor: number): SlotList {
		const start = floor * CAP;
		const end = start + (this.storage.highWater[floor] ?? 0);
		const list = this.list;
		let n = 0;
		if (this.words.length === 1) {
			const masks = this.storage.masks;
			const stride = this.storage.maskWords;
			const bit = this.bits[0] ?? 0;
			for (let s = start; s < end; s++)
				if (((masks[s * stride] ?? 0) & bit) === bit) list[n++] = s;
		} else {
			for (let s = start; s < end; s++) if (this.has(s as Slot)) list[n++] = s;
		}
		this.length = n;
		return this;
	}

	at(i: number): Slot {
		return (this.list[i] ?? 0) as Slot;
	}
}
