import { CAP, ID_FLOOR_STRIDE } from "../config";
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
	// Open addressing over slots, linear probing; holds slot + 1 so 0 means empty.
	private readonly index: Int32Array;

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
		this.index = new Int32Array(floors * INDEX_SIZE);
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
		this.insert(floor, id, slot);
		return slot as Slot;
	}

	release(floor: number, slot: Slot): void {
		this.unindex(floor, slot);
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
		const { index, ids } = this;
		const base = floor * INDEX_SIZE;
		for (let i = home(id); ; i = (i + 1) & INDEX_MASK) {
			const held = index[base + i] ?? 0;
			if (held === 0) return NONE;
			if (ids[held - 1] === id) return (held - 1) as Slot;
		}
	}

	// Takes a floor's index built elsewhere; probe order may differ from the original run, and nothing iterates it.
	adoptIndex(floor: number, table: Int32Array): void {
		this.index.set(table, floor * INDEX_SIZE);
	}

	floorOf(id: EntityId): number {
		for (let f = 0; f < this.floors; f++)
			if (this.slotOf(f, id) !== NONE) return f;
		return -1;
	}

	private insert(floor: number, id: number, slot: number): void {
		indexInsert(this.index, floor * INDEX_SIZE, this.ids, 0, id, slot);
	}

	// Backward-shift deletion: no tombstones, so probe chains never degrade.
	private unindex(floor: number, slot: number): void {
		const { index, ids } = this;
		const base = floor * INDEX_SIZE;
		let hole = home(ids[slot] ?? 0);
		while (index[base + hole] !== slot + 1) hole = (hole + 1) & INDEX_MASK;
		for (let j = (hole + 1) & INDEX_MASK; ; j = (j + 1) & INDEX_MASK) {
			const held = index[base + j] ?? 0;
			if (held === 0) break;
			const h = home(ids[held - 1] ?? 0);
			if (((j - h) & INDEX_MASK) >= ((j - hole) & INDEX_MASK)) {
				index[base + hole] = held;
				hole = j;
			}
		}
		index[base + hole] = 0;
	}
}

export const INDEX_SIZE = CAP * 2;
const INDEX_MASK = INDEX_SIZE - 1;
const INDEX_SHIFT = Math.clz32(INDEX_MASK);
const GOLDEN = 0x9e3779b1;
const home = (id: number) => Math.imul(id, GOLDEN) >>> INDEX_SHIFT;

// Returns false, leaving the table unchanged, when the id is already indexed.
// `ids[slot - idsBase]` must hold each indexed slot's id.
export function indexInsert(
	table: Int32Array,
	tableBase: number,
	ids: Int32Array,
	idsBase: number,
	id: number,
	slot: number,
): boolean {
	let i = home(id);
	for (;;) {
		const held = table[tableBase + i] ?? 0;
		if (held === 0) break;
		if (ids[held - 1 - idsBase] === id) return false;
		i = (i + 1) & INDEX_MASK;
	}
	table[tableBase + i] = slot + 1;
	return true;
}
