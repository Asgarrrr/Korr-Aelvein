import type { Slot } from "./ids";
import type { Column } from "./schema";

// The array stays private: a module holding a view has nothing to write through.
// One class for every field kind measured faster than one class per kind (bench/slice3.ts).
class GetterView {
	readonly #array: Column;

	constructor(array: Column) {
		this.#array = array;
	}

	get(slot: Slot): number {
		return this.#array[slot] ?? 0;
	}
}

export function readView(columns: Readonly<Record<string, Column>>): object {
	const view: Record<string, unknown> = {};
	for (const [field, column] of Object.entries(columns))
		view[field] = Object.freeze(new GetterView(column));
	return Object.freeze(view);
}

Object.freeze(GetterView.prototype);
