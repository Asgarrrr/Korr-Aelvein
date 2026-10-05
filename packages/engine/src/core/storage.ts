import { CAP, ID_FLOOR_STRIDE } from "./config";
import { type EntityId, NONE, type Slot } from "./ids";
import { type Column, createColumn, type FieldKind } from "./schema";

export const ALIVE = 1;
export const ACTOR = 2;
const CORE_BITS = 2;
const WORD_SHIFT = 5;
const WORD_MASK = 31;

export interface MaskBit {
	readonly word: number;
	readonly bit: number;
}

export class Storage {
	readonly maskWords: number;
	readonly masks: Int32Array;
	readonly columns: Column[] = [];
	readonly ids: Int32Array;
	readonly highWater: Int32Array;
	readonly freeCount: Int32Array;
	readonly free: Int32Array;
	readonly counters: Int32Array;
	private readonly idMaps: Map<number, Slot>[] = [];

	constructor(
		readonly floors: number,
		componentCount: number,
	) {
		this.maskWords = ((componentCount + CORE_BITS - 1) >> WORD_SHIFT) + 1;
		this.masks = new Int32Array(floors * CAP * this.maskWords);
		this.highWater = new Int32Array(floors);
		this.freeCount = new Int32Array(floors);
		this.free = new Int32Array(floors * CAP);
		this.counters = new Int32Array(floors);
		for (let f = 0; f < floors; f++) this.idMaps.push(new Map());
		this.ids = new Int32Array(floors * CAP);
		this.columns.push(this.ids);
	}

	column(kind: FieldKind): Column {
		const column = createColumn(kind, this.floors * CAP);
		this.columns.push(column);
		return column;
	}

	componentBit(component: number): MaskBit {
		const index = component + CORE_BITS;
		return { word: index >> WORD_SHIFT, bit: 1 << (index & WORD_MASK) };
	}

	alloc(floor: number): Slot {
		let slot: number;
		const freed = this.freeCount[floor] ?? 0;
		if (freed > 0) {
			this.freeCount[floor] = freed - 1;
			slot = this.free[floor * CAP + freed - 1] ?? 0;
		} else {
			const used = this.highWater[floor] ?? 0;
			if (used === CAP)
				throw new Error(`floor ${floor} is full (${CAP} slots)`);
			this.highWater[floor] = used + 1;
			slot = floor * CAP + used;
		}
		const counter = (this.counters[floor] ?? 0) + 1;
		if (counter >= ID_FLOOR_STRIDE)
			throw new Error(`floor ${floor} ran out of entity ids`);
		this.counters[floor] = counter;
		const id = floor * ID_FLOOR_STRIDE + counter;
		this.ids[slot] = id;
		this.masks[slot * this.maskWords] = ALIVE;
		this.idMap(floor).set(id, slot as Slot);
		return slot as Slot;
	}

	release(floor: number, slot: Slot): void {
		this.idMap(floor).delete(this.ids[slot] ?? 0);
		// Zero is every field's absent value, so the next entity in this slot starts clean.
		const columns = this.columns;
		for (let c = 0; c < columns.length; c++) {
			const column = columns[c];
			if (column) column[slot] = 0;
		}
		const words = this.maskWords;
		this.masks.fill(0, slot * words, (slot + 1) * words);
		const top = this.freeCount[floor] ?? 0;
		this.free[floor * CAP + top] = slot;
		this.freeCount[floor] = top + 1;
	}

	slotOf(floor: number, id: EntityId): Slot {
		return this.idMap(floor).get(id) ?? NONE;
	}

	floorOf(id: EntityId): number {
		for (let f = 0; f < this.floors; f++) if (this.idMap(f).has(id)) return f;
		return -1;
	}

	private idMap(floor: number): Map<number, Slot> {
		const map = this.idMaps[floor];
		if (!map) throw new Error(`no floor ${floor}`);
		return map;
	}
}
