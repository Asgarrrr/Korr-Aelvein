import type { CellField, ReadCtx, WriteCtx } from "../api";
import { type Cell, NO_CELL } from "../ecs/ids";
import type { Column } from "../ecs/schema";
import type { Context } from "../turns/context";

// The context names the floor, so a module never picks one and cannot reach another
// floor's slice of the array.
export class CellColumn implements CellField {
	readonly #array: Column;
	readonly #stride: number;
	readonly #cells: number;

	constructor(array: Column, stride: number, cells: number) {
		this.#array = array;
		this.#stride = stride;
		this.#cells = cells;
		Object.freeze(this);
	}

	get(ctx: ReadCtx, cell: Cell): number {
		if (cell === NO_CELL) return 0;
		return this.#array[this.#at(ctx, cell)] ?? 0;
	}

	set(ctx: WriteCtx, cell: Cell, value: number): void {
		(ctx as Context).checkWritable("cell write");
		this.#array[this.#at(ctx, cell)] = value;
	}

	clear(ctx: WriteCtx): void {
		(ctx as Context).checkWritable("cell write");
		const start = (ctx as Context).floor * this.#stride;
		this.#array.fill(0, start, start + this.#cells);
	}

	#at(ctx: ReadCtx, cell: Cell): number {
		if (!(Number.isInteger(cell) && cell >= 0 && cell < this.#cells))
			throw new Error(`cell ${cell} is not on the floor`);
		return (ctx as Context).floor * this.#stride + cell;
	}
}

Object.freeze(CellColumn.prototype);
