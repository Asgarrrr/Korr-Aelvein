import { FAIL, NO_CELL } from "../../../core/module/api";
import type { FearSense } from "../sense";
import type { FearBuilder, FearConfig, Proposal } from "../situation";

export function defineFlee(
	b: FearBuilder,
	sense: FearSense,
	cfg: FearConfig,
): Proposal {
	// Re-executed later from a cached decision, so the target must still be a perceived threat.
	// Cornered, it fails rather than idles: on a replay the creature then decides afresh.
	const flee = b.action("flee", "entity", ["wary"], (ctx, actor, threat) => {
		const here = ctx.cellOf(actor);
		if (!sense.hunted(ctx, actor, here) || !sense.sees(ctx, actor, threat))
			return FAIL;
		const cell = sense.escape(ctx, actor, sense.fire(ctx, here));
		if (cell === NO_CELL || cell === here) return FAIL;
		sense.markFleeing(actor);
		return ctx.instead(ctx.step, cell);
	});
	return (ctx, actor, s, out) => {
		if (s.close && s.escape !== NO_CELL && s.escape !== ctx.cellOf(actor))
			out.push(flee, s.threat, cfg.score);
	};
}
