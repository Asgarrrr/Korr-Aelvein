import type { Column } from "../ecs/schema";
import { ACTOR, ALIVE } from "../ecs/storage";
import type { Engine } from "../engine";
import { validLink } from "../travel/link";
import type { Rows } from "./rows";
import type { FieldView } from "./sparse";

// Only a non-actor leads somewhere, through its pool row, to a cell of another floor. Runs after
// checkPool, which bounds every pool row by the count.
export function checkLinks(
	engine: Engine,
	rows: Rows,
	view: (column: Column) => FieldView,
	floor: number,
): string | undefined {
	const { base, highWater, maskWords, masks } = rows;
	const { link, storage, grid } = engine;
	const pointers = view(storage.sparse.rowOf);
	const rowOf = new Uint16Array(
		pointers.buffer,
		pointers.byteOffset,
		pointers.length,
	);
	const floors = view(link.floor);
	const to = new Uint8Array(floors.buffer, floors.byteOffset, floors.length);
	const x = view(link.x);
	const y = view(link.y);
	for (let s = 0; s < highWater; s++) {
		const mask = masks[s * maskWords] ?? 0;
		if ((mask & ALIVE) === 0) continue;
		if (((masks[s * maskWords + link.word] ?? 0) & link.bit) === 0) continue;
		const row = (rowOf[s] ?? 0) - 1;
		if (row < 0) return `slot ${base + s} has a link but no pool row`;
		const goes = to[row] ?? 0;
		if (
			(mask & ACTOR) !== 0 ||
			!validLink(
				floor,
				goes,
				x[row] ?? 0,
				y[row] ?? 0,
				storage.floors,
				grid.width,
				grid.height,
			)
		)
			return `slot ${base + s} has a link to floor ${goes} that leads nowhere`;
	}
	return undefined;
}
