import { CAP } from "../config";
import type { Slot } from "./ids";
import { MaskBits } from "./mask";
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
	readonly #mask: MaskBits;
	readonly #storage: Storage;

	constructor(storage: Storage, required: readonly MaskBit[]) {
		this.#storage = storage;
		this.#mask = new MaskBits(storage, [{ word: 0, bit: ALIVE }, ...required]);
	}

	has(slot: Slot): boolean {
		return this.#mask.has(slot);
	}

	slots(ctx: OnFloor): SlotList {
		const floor = ctx.floor;
		const start = floor * CAP;
		const end = start + (this.#storage.highWater[floor] ?? 0);
		const list = this.#list;
		let n = 0;
		const mask = this.#mask;
		if (mask.words.length === 1) {
			const masks = this.#storage.masks;
			const stride = this.#storage.maskWords;
			const bit = mask.bits[0] ?? 0;
			for (let s = start; s < end; s++)
				if (((masks[s * stride] ?? 0) & bit) === bit) list[n++] = s;
		} else {
			for (let s = start; s < end; s++) if (mask.has(s as Slot)) list[n++] = s;
		}
		this.length = n;
		return this;
	}

	at(i: number): Slot {
		return (this.#list[i] ?? 0) as Slot;
	}
}

Object.freeze(MaskQuery.prototype);
