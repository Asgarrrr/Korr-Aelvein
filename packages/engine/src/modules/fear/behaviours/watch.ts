import {
	type ActionRef,
	type Builder,
	type ContractView,
	FAIL,
	type Slot,
} from "../../../core/module/api";
import type { cells, schema } from "../schema";

interface WatchDeps {
	readonly diet: ContractView<"diet"> | undefined;
	readonly edible: ContractView<"edible"> | undefined;
	readonly flightDistance: (actor: Slot) => number;
}

// Stands still with the threat in sight. Fails once the threat is out of sight or any eater
// of the actor's class is within flight distance, so the creature decides again.
export function watchAction(
	b: Builder<typeof schema, typeof cells>,
	{ diet, edible, flightDistance }: WatchDeps,
): ActionRef<"entity"> {
	return b.action(
		"watch",
		"entity",
		["wary"],
		(ctx, actor, threat, perception) => {
			if (!diet || !edible) return FAIL;
			const prey = edible.class.get(actor);
			const flight = flightDistance(actor);
			let seen = false;
			for (let i = 0; i < perception.count; i++) {
				if ((diet.eats.get(perception.slot(i)) & prey) === 0) continue;
				if (perception.dist(i) <= flight) return FAIL;
				if (perception.id(i) === threat) seen = true;
			}
			if (!seen) return FAIL;
			return ctx.instead(ctx.idle, null);
		},
	);
}
