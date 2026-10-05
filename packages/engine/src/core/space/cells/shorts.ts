import { type Cell, NO_CELL } from "../../ecs/ids";
import { offFloor, outside } from "./bounds";

// See bytes.ts. `words` views two cells at a time.
export class U16Reader {
	readonly #array: Uint16Array;
	readonly #words: Uint32Array;
	readonly #cells: number;

	constructor(array: Uint16Array, words: Uint32Array, cells: number) {
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
			if ((i & 1) === 0 && words[i >> 1] === 0) i += 2;
			else if (array[i] !== 0) return i as Cell;
			else i++;
		}
		return NO_CELL;
	}
}

export class U16Writer {
	readonly #array: Uint16Array;
	readonly #words: Uint32Array;
	readonly #cells: number;

	constructor(array: Uint16Array, words: Uint32Array, cells: number) {
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
			if ((i & 1) === 0 && words[i >> 1] === 0) i += 2;
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

export class I16Reader {
	readonly #array: Int16Array;
	readonly #words: Uint32Array;
	readonly #cells: number;

	constructor(array: Int16Array, words: Uint32Array, cells: number) {
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
			if ((i & 1) === 0 && words[i >> 1] === 0) i += 2;
			else if (array[i] !== 0) return i as Cell;
			else i++;
		}
		return NO_CELL;
	}
}

export class I16Writer {
	readonly #array: Int16Array;
	readonly #words: Uint32Array;
	readonly #cells: number;

	constructor(array: Int16Array, words: Uint32Array, cells: number) {
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
			if ((i & 1) === 0 && words[i >> 1] === 0) i += 2;
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

for (const kind of [U16Reader, U16Writer, I16Reader, I16Writer])
	Object.freeze(kind.prototype);
