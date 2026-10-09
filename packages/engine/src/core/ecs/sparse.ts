import { CAP } from "../config";
import { NONE, type Slot } from "./ids";
import { type Column, createColumn, type FieldKind } from "./schema";

// Each floor packs its sparse rows in [0, count): a release moves the floor's last row into the
// freed one, so a pool row is valid only until the next applied kill.
export class SparsePool {
	// Local row + 1, so 0 means the slot holds no pool row.
	readonly rowOf: Uint16Array;
	readonly counts: Int32Array;
	readonly columns: Column[] = [];
	readonly #slotOfRow: Int32Array;

	constructor(
		readonly floors: number,
		readonly rowsPerFloor: number,
	) {
		this.rowOf = new Uint16Array(floors * CAP);
		this.counts = new Int32Array(floors);
		this.#slotOfRow = new Int32Array(floors * rowsPerFloor);
	}

	column(kind: FieldKind): Column {
		const column = createColumn(kind, this.floors * this.rowsPerFloor);
		this.columns.push(column);
		return column;
	}

	row(slot: Slot): number {
		const local = this.rowOf[slot] ?? 0;
		if (local === 0) return NONE;
		return ((slot / CAP) | 0) * this.rowsPerFloor + local - 1;
	}

	full(floor: number): boolean {
		return this.counts[floor] === this.rowsPerFloor;
	}

	take(floor: number, slot: Slot): number {
		if (this.full(floor)) throw new Error(`floor ${floor} sparse pool is full`);
		if (this.rowOf[slot] !== 0)
			throw new Error(`slot ${slot} already holds a pool row`);
		const local = this.counts[floor] ?? 0;
		const row = floor * this.rowsPerFloor + local;
		this.#slotOfRow[row] = slot;
		this.rowOf[slot] = local + 1;
		this.counts[floor] = local + 1;
		return row;
	}

	release(floor: number, slot: Slot): void {
		const held = this.rowOf[slot] ?? 0;
		if (held === 0) return;
		const base = floor * this.rowsPerFloor;
		const freed = base + held - 1;
		const last = base + (this.counts[floor] ?? 0) - 1;
		const columns = this.columns;
		if (freed !== last) {
			for (let c = 0; c < columns.length; c++) {
				const column = columns[c] as Column;
				column[freed] = column[last] ?? 0;
			}
			const moved = this.#slotOfRow[last] ?? 0;
			this.#slotOfRow[freed] = moved;
			this.rowOf[moved] = held;
		}
		for (let c = 0; c < columns.length; c++) (columns[c] as Column)[last] = 0;
		this.counts[floor] = last - base;
	}

	rebuild(floor: number, highWater: number): void {
		const base = floor * this.rowsPerFloor;
		for (let s = floor * CAP; s < floor * CAP + highWater; s++) {
			const held = this.rowOf[s] ?? 0;
			if (held !== 0) this.#slotOfRow[base + held - 1] = s;
		}
	}
}
