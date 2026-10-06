import { FAIL, NO_CELL } from "../../../core/module/api";
import type { FearSense } from "../sense";
import type { FearBuilder, FearConfig, Proposal } from "../situation";

export function defineAvoid(
	b: FearBuilder,
	sense: FearSense,
	cfg: FearConfig,
): Proposal {
	// Targets nothing: the fire it flees moves and dies out, but the intent stays valid
	// for as long as any burning cell is near. Staying put is a way to flee too.
	const avoid = b.action("avoid", "none", ["wary"], (ctx, actor) => {
		const here = ctx.cellOf(actor);
		const fire = sense.fire(ctx, here);
		if (!sense.heated(ctx, actor, fire)) return FAIL;
		// Replayed past the alarm: an eater within flight fails it, so the creature decides afresh.
		if (sense.threatNear(ctx, actor, sense.flightDistance(actor))) return FAIL;
		const cell = sense.escape(ctx, actor, fire);
		if (cell === NO_CELL) return FAIL;
		if (cell === here) return ctx.instead(ctx.idle, null);
		return ctx.instead(ctx.step, cell);
	});
	return (_ctx, _actor, s, out) => {
		if (s.heated && !s.close && s.escape !== NO_CELL)
			out.push(avoid, null, cfg.fireScore);
	};
}
