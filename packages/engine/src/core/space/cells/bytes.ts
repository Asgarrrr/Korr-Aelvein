import { type Cell, NO_CELL } from "../../ecs/ids";
import { offFloor, outside } from "./bounds";

const PER_WORD = 4;
const LOW = PER_WORD - 1;
const SHIFT = 2;

// One class per array kind: a class shared across kinds measured several times slower.
// `words` views the same bytes four at a time, so `next` skips empty runs.
export class U8Reader {
	readonly #array: Uint8Array;
	readonly #words: Uint32Array;
	readonly #cells: number;

	constructor(array: Uint8Array, words: Uint32Array, cells: number) {
		this.#array = array;
		this.#words = words;
		this.#cells = cells;
		Object.freeze(this);
	}

	get(cell: Cell): number {
		if (cell >>> 0 >= this.#cells) return offFloor(cell);
		return this.#array[cell] ?? 0;
	}

	next(cell: Cell): Cell {
		const array = this.#array;
		const words = this.#words;
		const cells = this.#cells;
		for (let i = cell + 1; i < cells; ) {
			if ((i & LOW) === 0 && words[i >> SHIFT] === 0) i += PER_WORD;
			else if (array[i] !== 0) return i as Cell;
			else i++;
		}
		return NO_CELL;
	}
}

export class U8Writer {
	readonly #array: Uint8Array;
	readonly #words: Uint32Array;
	readonly #cells: number;

	constructor(array: Uint8Array, words: Uint32Array, cells: number) {
		this.#array = array;
		this.#words = words;
		this.#cells = cells;
		Object.freeze(this);
	}

	get(cell: Cell): number {
		if (cell >>> 0 >= this.#cells) return offFloor(cell);
		return this.#array[cell] ?? 0;
	}

	next(cell: Cell): Cell {
		const array = this.#array;
		const words = this.#words;
		const cells = this.#cells;
		for (let i = cell + 1; i < cells; ) {
			if ((i & LOW) === 0 && words[i >> SHIFT] === 0) i += PER_WORD;
			else if (array[i] !== 0) return i as Cell;
			else i++;
		}
		return NO_CELL;
	}

	set(cell: Cell, value: number): void {
		if (cell >>> 0 >= this.#cells) outside(cell);
		this.#array[cell] = value;
	}

	clear(): void {
		this.#array.fill(0);
	}
}

export class I8Reader {
	readonly #array: Int8Array;
	readonly #words: Uint32Array;
	readonly #cells: number;

	constructor(array: Int8Array, words: Uint32Array, cells: number) {
		this.#array = array;
		this.#words = words;
		this.#cells = cells;
		Object.freeze(this);
	}

	get(cell: Cell): number {
		if (cell >>> 0 >= this.#cells) return offFloor(cell);
		return this.#array[cell] ?? 0;
	}

	next(cell: Cell): Cell {
		const array = this.#array;
		const words = this.#words;
		const cells = this.#cells;
		for (let i = cell + 1; i < cells; ) {
			if ((i & LOW) === 0 && words[i >> SHIFT] === 0) i += PER_WORD;
			else if (array[i] !== 0) return i as Cell;
			else i++;
		}
		return NO_CELL;
	}
}

export class I8Writer {
	readonly #array: Int8Array;
	readonly #words: Uint32Array;
	readonly #cells: number;

	constructor(array: Int8Array, words: Uint32Array, cells: number) {
		this.#array = array;
		this.#words = words;
		this.#cells = cells;
		Object.freeze(this);
	}

	get(cell: Cell): number {
		if (cell >>> 0 >= this.#cells) return offFloor(cell);
		return this.#array[cell] ?? 0;
	}

	next(cell: Cell): Cell {
		const array = this.#array;
		const words = this.#words;
		const cells = this.#cells;
		for (let i = cell + 1; i < cells; ) {
			if ((i & LOW) === 0 && words[i >> SHIFT] === 0) i += PER_WORD;
			else if (array[i] !== 0) return i as Cell;
			else i++;
		}
		return NO_CELL;
	}

	set(cell: Cell, value: number): void {
		if (cell >>> 0 >= this.#cells) outside(cell);
		this.#array[cell] = value;
	}

	clear(): void {
		this.#array.fill(0);
	}
}

for (const kind of [U8Reader, U8Writer, I8Reader, I8Writer])
	Object.freeze(kind.prototype);
