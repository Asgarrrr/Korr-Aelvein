import { type Cell, NO_CELL } from "../../ecs/ids";
import { offFloor, outside } from "./bounds";

// See bytes.ts. Also serves entity fields.
export class I32Reader {
	readonly #array: Int32Array;
	readonly #cells: number;

	constructor(array: Int32Array, cells: number) {
		this.#array = array;
		this.#cells = cells;
		Object.freeze(this);
	}

	get(cell: Cell): number {
		if (cell >>> 0 >= this.#cells) return offFloor(cell);
		return this.#array[cell] ?? 0;
	}

	next(cell: Cell): Cell {
		const array = this.#array;
		const cells = this.#cells;
		for (let i = cell + 1; i < cells; i++) if (array[i] !== 0) return i as Cell;
		return NO_CELL;
	}
}

export class I32Writer {
	readonly #array: Int32Array;
	readonly #cells: number;

	constructor(array: Int32Array, cells: number) {
		this.#array = array;
		this.#cells = cells;
		Object.freeze(this);
	}

	get(cell: Cell): number {
		if (cell >>> 0 >= this.#cells) return offFloor(cell);
		return this.#array[cell] ?? 0;
	}

	next(cell: Cell): Cell {
		const array = this.#array;
		const cells = this.#cells;
		for (let i = cell + 1; i < cells; i++) if (array[i] !== 0) return i as Cell;
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

for (const kind of [I32Reader, I32Writer]) Object.freeze(kind.prototype);
