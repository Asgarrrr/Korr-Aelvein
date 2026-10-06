import { defineModule, NO_CELL } from "../../core/module/api";
import { wanderConfig } from "./config";

const DX = [-1, 0, 1, -1, 1, -1, 0, 1];
const DY = [-1, -1, -1, 0, 0, 1, 1, 1];

export const wander = defineModule({
	name: "wander",
	schema: {},
	config: wanderConfig,
	setup(b, cfg) {
		const roam = b.action("roam", "none", [], (ctx, actor) => {
			const d = ctx.rng(ctx.idOf(actor), 0, DX.length);
			const x = ctx.x(actor) + (DX[d] ?? 0);
			const y = ctx.y(actor) + (DY[d] ?? 0);
			const cell = ctx.cellAt(x, y);
			// A blocked step costs the turn, not the decision: a cached roam tries again next turn.
			if (cell === NO_CELL || ctx.holdsActor(cell))
				return ctx.instead(ctx.idle, null);
			return ctx.instead(ctx.step, cell);
		});
		b.propose((_ctx, _actor, _perception, out) => {
			out.push(roam, null, cfg.score);
		});
	},
});
