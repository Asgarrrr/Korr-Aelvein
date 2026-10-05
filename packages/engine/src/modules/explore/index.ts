import {
	type Cell,
	defineModule,
	FAIL,
	NO_CELL,
	NONE,
	PERCEPTION_RADIUS,
	type ReadCtx,
	type Slot,
} from "../../core/api";
import { exploreConfig } from "./config";
import { cells } from "./schema";

const DX = [-1, 0, 1, -1, 1, -1, 0, 1];
const DY = [-1, -1, -1, 0, 0, 1, 1, 1];

// The straight step toward the stairs first, then any other free step that also closes in.
function approach(
	ctx: ReadCtx,
	actor: Slot,
	dx: number,
	dy: number,
	dist: number,
): Cell {
	const x = ctx.x(actor);
	const y = ctx.y(actor);
	const sx = Math.sign(dx);
	const sy = Math.sign(dy);
	const straight = ctx.cellAt(x + sx, y + sy);
	if (!ctx.holdsActor(straight)) return straight;
	for (let d = 0; d < DX.length; d++) {
		const ox = DX[d] ?? 0;
		const oy = DY[d] ?? 0;
		if (ox === sx && oy === sy) continue;
		if (Math.max(Math.abs(dx - ox), Math.abs(dy - oy)) !== dist - 1) continue;
		const cell = ctx.cellAt(x + ox, y + oy);
		if (cell !== NO_CELL && !ctx.holdsActor(cell)) return cell;
	}
	return NO_CELL;
}

export const explore = defineModule({
	name: "explore",
	schema: {},
	cells,
	config: exploreConfig,
	setup(b, cfg) {
		const satiety = b.read("satiety");
		const diet = b.read("diet");
		const edible = b.read("edible");
		// Without hunger nothing makes a creature restless.
		if (!satiety || !diet || !edible) return;
		const fed = b.query(["satiety"]);
		const stairs = b.query(["link"]);
		const exits = b.cells("exits");

		// Marks every cell from which stairs are in perception, so a restless creature elsewhere skips
		// the scan. Stairs spawned after this tick go unmarked until the next round.
		b.tick((ctx) => {
			const near = exits.near.write(ctx);
			near.clear();
			const rows = stairs.slots(ctx);
			for (let i = 0; i < rows.length; i++) {
				const s = rows.at(i);
				const x = ctx.x(s);
				const y = ctx.y(s);
				for (let dy = -PERCEPTION_RADIUS; dy <= PERCEPTION_RADIUS; dy++)
					for (let dx = -PERCEPTION_RADIUS; dx <= PERCEPTION_RADIUS; dx++) {
						const cell = ctx.cellAt(x + dx, y + dy);
						if (cell !== NO_CELL) near.set(cell, 1);
					}
			}
		});

		const leave = b.action("leave", "entity", (ctx, actor, target) => {
			const slot = ctx.slotOf(target);
			// Only propose names stairs, and a link never leaves its entity: core.travel checks it anyway.
			if (slot === NONE) return FAIL;
			const dx = ctx.x(slot) - ctx.x(actor);
			const dy = ctx.y(slot) - ctx.y(actor);
			const dist = Math.max(Math.abs(dx), Math.abs(dy));
			if (dist <= 1) return ctx.instead(ctx.travel, target);
			const cell = approach(ctx, actor, dx, dy, dist);
			// Blocked for now, not wrong: the decision stands and the turn passes.
			return cell === NO_CELL
				? ctx.instead(ctx.idle, null)
				: ctx.instead(ctx.step, cell);
		});

		b.propose((ctx, actor, perception, out) => {
			if (!fed.has(actor) || satiety.value.get(actor) >= cfg.restlessBelow)
				return;
			const here = ctx.cellAt(ctx.x(actor), ctx.y(actor));
			if (exits.near.read(ctx).get(here) === 0) return;
			const count = perception.count;
			let exit = -1;
			for (let i = 0; i < count && exit < 0; i++)
				if (stairs.has(perception.slot(i))) exit = i;
			if (exit < 0) return;
			// Stairs are rare in view, so the food scan runs only once some are in sight.
			const eats = diet.eats.get(actor);
			for (let i = 0; i < count; i++)
				if ((edible.class.get(perception.slot(i)) & eats) !== 0) return;
			out.push(leave, perception.id(exit), cfg.score);
		});
	},
});
