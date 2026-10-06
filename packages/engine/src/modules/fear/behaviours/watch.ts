import {
	type ActionRef,
	type Builder,
	type ContractView,
	type EntityId,
	FAIL,
	type ReadCtx,
	type Slot,
} from "../../../core/module/api";
import type { cells, schema } from "../schema";

interface WatchDeps {
	readonly edible: ContractView<"edible"> | undefined;
	readonly flightDistance: (actor: Slot) => number;
	readonly starving: (actor: Slot) => boolean;
	readonly threatNear: (
		ctx: ReadCtx,
		actor: Slot,
		prey: number,
		radius: number,
	) => boolean;
	readonly sees: (
		ctx: ReadCtx,
		actor: Slot,
		threat: EntityId,
		prey: number,
	) => boolean;
}

// Stands still with the threat in sight. Fails once the threat is out of sight, any eater of the
// actor's class is within flight distance, or the actor is starving, so it decides again.
export function watchAction(
	b: Builder<typeof schema, typeof cells>,
	{ edible, flightDistance, starving, threatNear, sees }: WatchDeps,
): ActionRef<"entity"> {
	return b.action("watch", "entity", ["wary"], (ctx, actor, threat) => {
		if (!edible || starving(actor)) return FAIL;
		const prey = edible.class.get(actor);
		if (threatNear(ctx, actor, prey, flightDistance(actor))) return FAIL;
		if (!sees(ctx, actor, threat, prey)) return FAIL;
		return ctx.instead(ctx.idle, null);
	});
}
