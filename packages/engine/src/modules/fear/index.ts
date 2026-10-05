import {
	type Cell,
	defineModule,
	FAIL,
	type FieldView,
	NO_CELL,
	PERCEPTION_RADIUS,
	type Perception,
	type ReadCtx,
	type Slot,
} from "../../core/api";
import { fearConfig } from "./config";
import { cells, schema } from "./schema";

const DX = [-1, 0, 1, -1, 1, -1, 0, 1];
const DY = [-1, -1, -1, 0, 0, 1, 1, 1];
const UNSEEN = Number.MAX_SAFE_INTEGER;
// Only core.step moves an actor, one cell per execution at a cost of TICKS_PER_TURN, so a
// creature moves at most one cell between fear's tick and its prey's turn.
const MARGIN = 1;

// Never closer to any perceived threat: an equal distance is a sidestep, the best a
// cornered creature has. Among those, the cell farthest from its nearest threat wins.
// Ties prefer a straight step, because the first diagonal in list order drives every
// fleer into one corner.
function fleeCell(
	ctx: ReadCtx,
	actor: Slot,
	perception: Perception,
	eats: FieldView<"u8">,
	prey: number,
): Cell {
	const count = perception.count;
	const x = ctx.x(actor);
	const y = ctx.y(actor);
	let best = NO_CELL;
	let farthest = -1;
	let straight = false;
	for (let d = 0; d < DX.length; d++) {
		const dx = DX[d] ?? 0;
		const dy = DY[d] ?? 0;
		const cell = ctx.cellAt(x + dx, y + dy);
		if (cell === NO_CELL) continue;
		let nearest = UNSEEN;
		for (let i = 0; i < count && nearest >= 0; i++) {
			if ((eats.get(perception.slot(i)) & prey) === 0) continue;
			const tx = perception.dx(i);
			const ty = perception.dy(i);
			const then = Math.max(Math.abs(tx - dx), Math.abs(ty - dy));
			if (then < Math.max(Math.abs(tx), Math.abs(ty))) nearest = -1;
			else if (then < nearest) nearest = then;
		}
		if (nearest < 0 || nearest === UNSEEN) continue;
		const axial = dx === 0 || dy === 0;
		if (nearest < farthest) continue;
		if (nearest === farthest && (straight || !axial)) continue;
		if (ctx.holdsActor(cell)) continue;
		best = cell;
		farthest = nearest;
		straight = axial;
	}
	return best;
}

export const fear = defineModule({
	name: "fear",
	schema,
	cells,
	config: fearConfig,
	setup(b, cfg) {
		const diet = b.read("diet");
		const edible = b.read("edible");
		const wary = b.query(["wary"]);
		const danger = b.cells("danger").eats;
		const eaters = diet ? b.query(["diet"]) : undefined;
		const reach = PERCEPTION_RADIUS + MARGIN;

		// Marks, per class of wary prey, every cell from which a prey could see an eater of
		// that class this round, so a calm prey skips its perception.
		b.tick((ctx, floor) => {
			danger.clear(ctx);
			if (!edible || !diet || !eaters) return;
			const prey = wary.slots(floor);
			let preyMask = 0;
			for (let i = 0; i < prey.length; i++)
				preyMask |= edible.class.get(prey.at(i));
			if (preyMask === 0) return;
			const rows = eaters.slots(floor);
			for (let i = 0; i < rows.length; i++) {
				const s = rows.at(i);
				const bits = diet.eats.get(s) & preyMask;
				if (bits === 0) continue;
				const x = ctx.x(s);
				const y = ctx.y(s);
				for (let dy = -reach; dy <= reach; dy++)
					for (let dx = -reach; dx <= reach; dx++) {
						const cell = ctx.cellAt(x + dx, y + dy);
						if (cell !== NO_CELL)
							danger.set(ctx, cell, danger.get(ctx, cell) | bits);
					}
			}
		});

		// Re-executed later from a cached decision, so the target must still be a perceived threat.
		const flee = b.action(
			"flee",
			"entity",
			(ctx, actor, threat, perception) => {
				if (!diet || !edible) return FAIL;
				const prey = edible.class.get(actor);
				const eats = diet.eats;
				const count = perception.count;
				let seen = false;
				for (let i = 0; i < count && !seen; i++)
					seen =
						perception.id(i) === threat &&
						(eats.get(perception.slot(i)) & prey) !== 0;
				if (!seen) return FAIL;
				const cell = fleeCell(ctx, actor, perception, eats, prey);
				return cell === NO_CELL ? FAIL : ctx.instead(ctx.step, cell);
			},
		);

		b.propose((ctx, actor, perception, out) => {
			if (!diet || !edible || !wary.has(actor)) return;
			const prey = edible.class.get(actor);
			if (prey === 0) return;
			const here = ctx.cellAt(ctx.x(actor), ctx.y(actor));
			if ((danger.get(ctx, here) & prey) === 0) return;
			const eats = diet.eats;
			const count = perception.count;
			for (let i = 0; i < count; i++) {
				if ((eats.get(perception.slot(i)) & prey) === 0) continue;
				if (fleeCell(ctx, actor, perception, eats, prey) !== NO_CELL)
					out.push(flee, perception.id(i), cfg.score);
				return;
			}
		});
	},
});
