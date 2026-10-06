import { defineModule, FAIL, NO_CELL, NONE } from "../../src/core/module/api";

const thirstConfig = {
	decayPerTurn: 2,
	thirstyBelow: 400,
	// Between fear and hunger: a thirsty creature drinks before it eats, never before it flees.
	score: 400,
	sipCost: 100,
	// Sips a spring regains per round, up to its fill.
	refill: 1,
	fill: 30,
} as const;

// A fake mechanic shaped like hunger: a bulk tick over two component ranges, a proposer that
// reads perception, and a goal action that walks to its target.
export const thirst = defineModule({
	name: "thirst",
	schema: {
		hydration: { value: "i32", max: "i32", drank: "i32" },
		spring: { gives: "i16", left: "i16" },
	},
	config: thirstConfig,
	setup(b, cfg) {
		const hydration = b.write("hydration");
		const spring = b.write("spring");
		const drinkers = b.query(["hydration"]);
		const springs = b.query(["spring"]);

		b.tick((ctx) => {
			const rows = drinkers.slots(ctx);
			const value = hydration.value;
			const decay = cfg.decayPerTurn;
			for (let i = 0; i < rows.length; i++) {
				const s = rows.at(i);
				const left = (value[s] ?? 0) - decay;
				value[s] = left > 0 ? left : 0;
			}
			const wells = springs.slots(ctx);
			const sips = spring.left;
			for (let i = 0; i < wells.length; i++) {
				const s = wells.at(i);
				const left = (sips[s] ?? 0) + cfg.refill;
				sips[s] = left < cfg.fill ? left : cfg.fill;
			}
		});

		const drink = b.action(
			"drink",
			"entity",
			["hydration"],
			(ctx, actor, target) => {
				const well = ctx.slotOf(target);
				if (
					well === NONE ||
					!springs.has(well) ||
					(spring.left[well] ?? 0) <= 0
				)
					return FAIL;
				const dx = ctx.x(well) - ctx.x(actor);
				const dy = ctx.y(well) - ctx.y(actor);
				if (Math.max(Math.abs(dx), Math.abs(dy)) > 1) {
					const cell = ctx.approach(actor, ctx.x(well), ctx.y(well));
					return cell === NO_CELL
						? ctx.instead(ctx.idle, null)
						: ctx.instead(ctx.step, cell);
				}
				const gives = spring.gives[well] ?? 0;
				const full = (hydration.value[actor] ?? 0) + gives;
				const max = hydration.max[actor] ?? 0;
				hydration.value[actor] = full < max ? full : max;
				hydration.drank[actor] = (hydration.drank[actor] ?? 0) + gives;
				spring.left[well] = (spring.left[well] ?? 0) - 1;
				return cfg.sipCost;
			},
		);

		b.propose((_ctx, actor, perception, out) => {
			if (!drinkers.has(actor)) return;
			if ((hydration.value[actor] ?? 0) >= cfg.thirstyBelow) return;
			for (let i = 0; i < perception.count; i++) {
				const s = perception.slot(i);
				if (!springs.has(s) || (spring.left[s] ?? 0) <= 0) continue;
				out.push(drink, perception.id(i), cfg.score);
				return;
			}
		});
	},
});
