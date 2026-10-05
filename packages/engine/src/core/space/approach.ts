import { type Cell, NO_CELL, NONE, type Slot } from "../ecs/ids";
import type { Grid } from "./grid";

const DX = [-1, 0, 1, -1, 1, -1, 0, 1];
const DY = [-1, -1, -1, 0, 0, 1, 1, 1];

export function approach(
	grid: Grid,
	floor: number,
	actor: Slot,
	tx: number,
	ty: number,
): Cell {
	const x = grid.x[actor] ?? 0;
	const y = grid.y[actor] ?? 0;
	const dx = tx - x;
	const dy = ty - y;
	const dist = Math.max(Math.abs(dx), Math.abs(dy));
	const sx = Math.sign(dx);
	const sy = Math.sign(dy);
	const straight = grid.cellAt(x + sx, y + sy);
	if (straight === NO_CELL || !grid.holdsOtherActor(floor, straight, NONE))
		return straight;
	for (let d = 0; d < DX.length; d++) {
		const ox = DX[d] ?? 0;
		const oy = DY[d] ?? 0;
		if (ox === sx && oy === sy) continue;
		if (Math.max(Math.abs(dx - ox), Math.abs(dy - oy)) !== dist - 1) continue;
		const cell = grid.cellAt(x + ox, y + oy);
		if (cell !== NO_CELL && !grid.holdsOtherActor(floor, cell, NONE))
			return cell;
	}
	return NO_CELL;
}
