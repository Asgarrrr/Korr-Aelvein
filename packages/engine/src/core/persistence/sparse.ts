import type { Column } from "../ecs/schema";
import type { Engine } from "../engine";
import type { Rows } from "./rows";

export type FieldView = Int8Array | Int16Array | Int32Array;

// A pool image is sound when each live sparse row owns one distinct pool row below the count,
// and no pool row holds a value in a sparse component its owner lacks. "fast" checks only the
// row pointers, which a later release and rebuild index by.
export function checkPool(
	engine: Engine,
	rows: Rows,
	count: number,
	view: (column: Column) => FieldView,
	full: boolean,
): string | undefined {
	const { base, highWater, maskWords, masks } = rows;
	const { sparseMask, checkPooled: seen } = engine;
	const pointers = view(engine.storage.sparse.rowOf);
	const rowOf = new Uint16Array(
		pointers.buffer,
		pointers.byteOffset,
		pointers.length,
	);
	seen.fill(0, 0, count);
	let held = 0;
	for (let s = 0; s < highWater; s++) {
		const row = rowOf[s] ?? 0;
		if (full) {
			let pooled = false;
			for (let w = 0; w < maskWords; w++)
				if (((masks[s * maskWords + w] ?? 0) & (sparseMask[w] ?? 0)) !== 0)
					pooled = true;
			if (pooled !== (row !== 0))
				return `slot ${base + s}: pool row ${row} with sparse bits ${pooled}`;
		}
		if (row === 0) continue;
		if (row > count)
			return `slot ${base + s}: pool row ${row} past the count ${count}`;
		if (seen[row - 1] !== 0) return `pool row ${row} is shared`;
		seen[row - 1] = 1;
		held++;
	}
	if (held !== count) return `${held} pool rows held, count ${count}`;
	if (!full) return undefined;
	for (const { sparse, bit, columns } of engine.components.values()) {
		if (!sparse) continue;
		const fields = Object.values(columns).map(view);
		for (let s = 0; s < highWater; s++) {
			const row = (rowOf[s] ?? 0) - 1;
			if (row < 0 || ((masks[s * maskWords + bit.word] ?? 0) & bit.bit) !== 0)
				continue;
			for (const field of fields)
				if (field[row] !== 0)
					return `slot ${base + s}: a value in a sparse component it lacks`;
		}
	}
	return undefined;
}
