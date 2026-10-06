import { band, FAIL, NO_ENTITY } from "../../../core/module/api";
import type { FearSense } from "../sense";
import type { FearBuilder, FearConfig, Proposal } from "../situation";

// Stands still with the threat in sight. Fails once the threat is out of sight, any eater of the
// actor's class is within flight distance, or the actor is starving, so it decides again.
export function defineWatch(
	b: FearBuilder,
	sense: FearSense,
	cfg: FearConfig,
): Proposal {
	const score = band("vigilance", cfg.watchWeight);
	const watch = b.action("watch", "entity", ["wary"], (ctx, actor, threat) => {
		if (
			sense.starving(actor) ||
			sense.threatNear(ctx, actor, sense.flightDistance(actor)) ||
			!sense.sees(ctx, actor, threat)
		)
			return FAIL;
		return ctx.instead(ctx.idle, null);
	});
	return (_ctx, actor, s, out) => {
		if (s.threat !== NO_ENTITY && !s.close && !sense.starving(actor))
			out.push(watch, s.threat, score);
	};
}
