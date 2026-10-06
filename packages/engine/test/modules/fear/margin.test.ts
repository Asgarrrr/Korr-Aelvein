import { expect, test } from "bun:test";
import { TICKS_PER_TURN } from "../../../src/core/config";
import { ALTERNATE, type AnyModule, FAIL } from "../../../src/core/module/api";
import { modules } from "../../../src/registry";
import { forwardBuilder, seededWorld } from "../../fixtures";

// Fear's MARGIN stamps assume an eater moves at most one cell after fear's tick: every action
// must cost exactly one turn. Core step, idle and travel return TICKS_PER_TURN in code.
test("on a seeded 300-round world, every registered action costs one turn", () => {
	const costs = new Map<string, Set<number>>();
	const recorded = (module: AnyModule): AnyModule => ({
		...module,
		setup(b, cfg) {
			module.setup(
				{
					...forwardBuilder(b),
					action: (name, kind, requires, run) => {
						const label = `${module.name}/${name}`;
						costs.set(label, new Set());
						return b.action(
							name,
							kind,
							requires,
							(ctx, actor, target, perception) => {
								const result = run(ctx, actor, target, perception);
								if (result !== FAIL) costs.get(label)?.add(result);
								return result;
							},
						);
					},
				},
				cfg,
			);
		},
	});
	seededWorld(modules.map(recorded)).runRounds(300);
	expect(costs.size).toBeGreaterThan(0);
	for (const [name, seen] of costs) {
		expect({ name, ran: seen.size > 0 }).toEqual({ name, ran: true });
		for (const cost of seen)
			if (cost !== ALTERNATE)
				expect({ name, cost }).toEqual({ name, cost: TICKS_PER_TURN });
	}
});
