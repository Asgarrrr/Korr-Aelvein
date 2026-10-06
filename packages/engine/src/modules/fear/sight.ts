import {
	type Cell,
	type CellReader,
	type EntityId,
	type FieldView,
	NONE,
	PERCEPTION_RADIUS,
	type ReadCtx,
	type Slot,
} from "../../core/module/api";
import { MARGIN } from "./config";

// The classes eaten by an eater that stood within MARGIN at fear's tick: only there can one stand now.
export type Near = CellReader<"u8">;

// The first eater of `prey` in the cell's list, skipping the actor; NONE if none.
export function eaterAt(
	ctx: ReadCtx,
	cell: Cell,
	actor: Slot,
	eats: FieldView<"u8">,
	prey: number,
): Slot {
	for (let s = ctx.firstAt(cell); s !== NONE; s = ctx.nextAt(s))
		if (s !== actor && (eats.get(s) & prey) !== 0) return s;
	return NONE;
}

// The nearest eater of `prey` within `radius`, in perception's order so ties resolve alike.
export function nearestEater(
	ctx: ReadCtx,
	actor: Slot,
	eats: FieldView<"u8">,
	near: Near,
	prey: number,
	radius: number,
): Slot {
	const x = ctx.x(actor);
	const y = ctx.y(actor);
	const width = ctx.width;
	const height = ctx.height;
	for (let d = 0; d <= radius; d++)
		for (let dy = -d; dy <= d; dy++) {
			const yy = y + dy;
			if (yy < 0 || yy >= height) continue;
			const stride = dy === -d || dy === d || d === 0 ? 1 : 2 * d;
			for (let dx = -d; dx <= d; dx += stride) {
				const xx = x + dx;
				if (xx < 0 || xx >= width) continue;
				const cell = ctx.cellAt(xx, yy);
				if ((near.get(cell) & prey) === 0) continue;
				const s = eaterAt(ctx, cell, actor, eats, prey);
				if (s !== NONE) return s;
			}
		}
	return NONE;
}

// Whether `threat` is an eater of `prey` the actor can see, as perception would list it.
export function sees(
	ctx: ReadCtx,
	actor: Slot,
	threat: EntityId,
	eats: FieldView<"u8">,
	prey: number,
): boolean {
	const s = ctx.slotOf(threat);
	if (s === NONE || s === actor || (eats.get(s) & prey) === 0) return false;
	const dx = Math.abs(ctx.x(s) - ctx.x(actor));
	const dy = Math.abs(ctx.y(s) - ctx.y(actor));
	return (dx > dy ? dx : dy) <= PERCEPTION_RADIUS;
}
