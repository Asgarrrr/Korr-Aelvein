import { defineModule } from "../../core/api";
import { wanderConfig } from "./config";

const DX = [-1, 0, 1, -1, 1, -1, 0, 1];
const DY = [-1, -1, -1, 0, 0, 1, 1, 1];

export const wander = defineModule({
	name: "wander",
	schema: {},
	config: wanderConfig,
	setup(b, cfg) {
		b.propose((ctx, actor, _perception, out) => {
			const d = ctx.rng(ctx.idOf(actor), 0, DX.length);
			const x = ctx.x(actor) + (DX[d] ?? 0);
			const y = ctx.y(actor) + (DY[d] ?? 0);
			out.push(ctx.step, ctx.cellAt(x, y), cfg.score);
		});
	},
});
