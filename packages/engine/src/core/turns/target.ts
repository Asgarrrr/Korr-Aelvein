import { ID_FLOOR_STRIDE } from "../config";
import type { TargetKind } from "../module/api";

export const KIND_CODE: Readonly<Record<TargetKind, number>> = {
	none: 0,
	entity: 1,
	cell: 2,
};

// An entity id's counter part: zero is never issued.
const COUNTER_MASK = ID_FLOOR_STRIDE - 1;

// One rule for proposals, alternates and loaded intents, so nothing a module can push is
// rejected later by a load.
export function validTarget(
	kind: number,
	target: number,
	cells: number,
	floors: number,
): boolean {
	if (kind === KIND_CODE.none) return target === 0;
	if (kind === KIND_CODE.cell) return target >= 0 && target < cells;
	return (
		target > 0 &&
		(target & COUNTER_MASK) !== 0 &&
		Math.floor(target / ID_FLOOR_STRIDE) < floors
	);
}
