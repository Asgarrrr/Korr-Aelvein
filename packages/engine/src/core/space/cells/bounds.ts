import { type Cell, NO_CELL } from "../../ecs/ids";

export function offFloor(cell: Cell): number {
	if (cell === NO_CELL) return 0;
	return outside(cell);
}

export function outside(cell: Cell): never {
	throw new Error(`cell ${cell} is not on the floor`);
}
