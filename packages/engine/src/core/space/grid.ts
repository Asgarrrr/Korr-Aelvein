import { type Cell, NO_CELL, type Slot } from "../ecs/ids";
import { ACTOR, type Storage } from "../ecs/storage";

export const END = -1;
const CELL_ALIGN = 4;

export class Grid {
	readonly cells: number;
	// Each floor's slice of a byte-wide cell column starts on a word, as images copy words.
	readonly stride: number;
	readonly heads: Int32Array;
	readonly x: Int16Array;
	readonly y: Int16Array;
	readonly cellOf: Int32Array;
	readonly next: Int32Array;
	readonly prev: Int32Array;

	constructor(
		private readonly storage: Storage,
		readonly width: number,
		readonly height: number,
	) {
		this.cells = width * height;
		this.stride = Math.ceil(this.cells / CELL_ALIGN) * CELL_ALIGN;
		this.heads = new Int32Array(storage.floors * this.cells).fill(END);
		this.x = storage.column("i16") as Int16Array;
		this.y = storage.column("i16") as Int16Array;
		this.cellOf = storage.column("i32") as Int32Array;
		this.next = storage.column("i32") as Int32Array;
		this.prev = storage.column("i32") as Int32Array;
	}

	cellAt(x: number, y: number): Cell {
		if ((x | 0) !== x || (y | 0) !== y)
			throw new Error(`cell (${x}, ${y}) is not an integer position`);
		if (x < 0 || y < 0 || x >= this.width || y >= this.height) return NO_CELL;
		return (y * this.width + x) as Cell;
	}

	insert(floor: number, slot: Slot, x: number, y: number): void {
		const cell = y * this.width + x;
		const at = floor * this.cells + cell;
		const head = this.heads[at] ?? END;
		this.next[slot] = head;
		this.prev[slot] = END;
		if (head !== END) this.prev[head] = slot;
		this.heads[at] = slot;
		this.cellOf[slot] = cell;
		this.x[slot] = x;
		this.y[slot] = y;
	}

	remove(floor: number, slot: Slot): void {
		const prev = this.prev[slot] ?? END;
		const next = this.next[slot] ?? END;
		if (prev !== END) this.next[prev] = next;
		else this.heads[floor * this.cells + (this.cellOf[slot] ?? 0)] = next;
		if (next !== END) this.prev[next] = prev;
	}

	move(floor: number, slot: Slot, cell: Cell): void {
		this.remove(floor, slot);
		this.insert(floor, slot, cell % this.width, (cell / this.width) | 0);
	}

	holdsOtherActor(floor: number, cell: Cell, self: Slot): boolean {
		const masks = this.storage.masks;
		const words = this.storage.maskWords;
		const next = this.next;
		for (
			let s = this.heads[floor * this.cells + cell] ?? END;
			s !== END;
			s = next[s] ?? END
		)
			if (s !== self && ((masks[s * words] ?? 0) & ACTOR) !== 0) return true;
		return false;
	}
}
