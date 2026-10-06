import {
	type Cell,
	type CellReader,
	type FieldView,
	NO_CELL,
	NONE,
	PERCEPTION_RADIUS,
	type ReadCtx,
	type Slot,
} from "../../core/module/api";
import { eaterAt, type Near } from "./sight";

type Burning = CellReader<"u8">;

const DX = [-1, 0, 1, -1, 1, -1, 0, 1];
const DY = [-1, -1, -1, 0, 0, 1, 1, 1];
const DIRS = DX.length;
// Indexes into DX and DY.
const NW = 0;
const N = 1;
const NE = 2;
const W = 3;
const E = 4;
const SW = 5;
const S = 6;
const SE = 7;
const UNSEEN = Number.MAX_SAFE_INTEGER;
// Folds the distance from step (dx, dy) to a threat at (tx, ty) into `held` by min.
// Returns -1 once the step closes on any threat. Min keeps -1, so threat order cannot show.
function closer(
	held: number,
	tx: number,
	ty: number,
	dx: number,
	dy: number,
): number {
	const then = Math.max(Math.abs(tx - dx), Math.abs(ty - dy));
	if (then < Math.max(Math.abs(tx), Math.abs(ty))) return -1;
	return then < held ? then : held;
}

// The step kept so far, packed as (farthest + 1) * DIRS + d, or -1, weighed against step d.
function consider(
	ctx: ReadCtx,
	x: number,
	y: number,
	d: number,
	nearest: number,
	kept: number,
): number {
	if (nearest < 0 || nearest === UNSEEN) return kept;
	const dx = DX[d] ?? 0;
	const dy = DY[d] ?? 0;
	const cell = ctx.cellAt(x + dx, y + dy);
	if (cell === NO_CELL) return kept;
	const farthest = kept < 0 ? -1 : Math.floor(kept / DIRS) - 1;
	const keptD = kept < 0 ? -1 : kept % DIRS;
	const straight = keptD >= 0 && (DX[keptD] === 0 || DY[keptD] === 0);
	const axial = dx === 0 || dy === 0;
	if (nearest < farthest) return kept;
	if (nearest === farthest && (straight || !axial)) return kept;
	if (ctx.holdsActor(cell)) return kept;
	return (nearest + 1) * DIRS + d;
}

// The step never closer to any threat (eater in sight, burning cell within radius) that is
// farthest from the nearest, straight steps first; else the actor's own cell; NO_CELL if no threat.
// Each threat is read once into eight locals: a per-call array measured +60-100 MB of RSS (213-251
// vs 152 MB), and a module keeps no scratch outside its columns.
export function fleeCell(
	ctx: ReadCtx,
	actor: Slot,
	eats: FieldView<"u8"> | undefined,
	near: Near,
	prey: number,
	burning: Burning | undefined,
	radius: number,
): Cell {
	const x = ctx.x(actor);
	const y = ctx.y(actor);
	const width = ctx.width;
	const height = ctx.height;
	let n0 = UNSEEN;
	let n1 = UNSEEN;
	let n2 = UNSEEN;
	let n3 = UNSEEN;
	let n4 = UNSEEN;
	let n5 = UNSEEN;
	let n6 = UNSEEN;
	let n7 = UNSEEN;
	let threatened = false;
	// Phase 0: eaters in sight, one threat per cell, as the folds below are idempotent.
	// Phase 1: each burning cell of the fire box.
	for (let phase = 0; phase < 2; phase++) {
		const eye = phase === 0;
		if (eye ? eats === undefined || prey === 0 : burning === undefined)
			continue;
		const r = eye ? PERCEPTION_RADIUS : radius;
		for (let ty = -r; ty <= r; ty++) {
			const yy = y + ty;
			if (yy < 0 || yy >= height) continue;
			for (let tx = -r; tx <= r; tx++) {
				const xx = x + tx;
				if (xx < 0 || xx >= width) continue;
				const cell = ctx.cellAt(xx, yy);
				if (
					eye
						? (near.get(cell) & prey) === 0 ||
							eats === undefined ||
							eaterAt(ctx, cell, actor, eats, prey) === NONE
						: burning?.get(cell) === 0
				)
					continue;
				threatened = true;
				n0 = closer(n0, tx, ty, -1, -1);
				n1 = closer(n1, tx, ty, 0, -1);
				n2 = closer(n2, tx, ty, 1, -1);
				n3 = closer(n3, tx, ty, -1, 0);
				n4 = closer(n4, tx, ty, 1, 0);
				n5 = closer(n5, tx, ty, -1, 1);
				n6 = closer(n6, tx, ty, 0, 1);
				n7 = closer(n7, tx, ty, 1, 1);
			}
		}
	}
	if (!threatened) return NO_CELL;
	let kept = consider(ctx, x, y, NW, n0, -1);
	kept = consider(ctx, x, y, N, n1, kept);
	kept = consider(ctx, x, y, NE, n2, kept);
	kept = consider(ctx, x, y, W, n3, kept);
	kept = consider(ctx, x, y, E, n4, kept);
	kept = consider(ctx, x, y, SW, n5, kept);
	kept = consider(ctx, x, y, S, n6, kept);
	kept = consider(ctx, x, y, SE, n7, kept);
	// Staying is never closer to anything, so it is the fallback whenever a threat is in reach.
	if (kept < 0) return ctx.cellAt(x, y);
	const d = kept % DIRS;
	return ctx.cellAt(x + (DX[d] ?? 0), y + (DY[d] ?? 0));
}
