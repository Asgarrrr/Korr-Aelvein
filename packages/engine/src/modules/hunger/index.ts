import { defineModule, FAIL, NO_CELL, NONE } from "../../core/module/api";
import { hungerConfig } from "./config";
import { schema } from "./schema";

export const hunger = defineModule({
	name: "hunger",
	schema,
	config: hungerConfig,
	setup(b, cfg) {
		const satiety = b.write("satiety");
		const edible = b.write("edible");
		const diet = b.write("diet");
		const fed = b.query(["satiety"]);
		const food = b.query(["edible"]);
		const ate = b.event("ate");

		b.tick((ctx) => {
			const rows = fed.slots(ctx);
			const value = satiety.value;
			const decay = cfg.decayPerTurn;
			for (let i = 0; i < rows.length; i++) {
				const s = rows.at(i);
				const left = (value[s] ?? 0) - decay;
				value[s] = left;
				if (left <= 0) ctx.kill(ctx.idOf(s), ctx.idOf(s));
			}
		});

		const eat = b.action(
			"eat",
			"entity",
			["satiety", "diet"],
			(ctx, actor, target) => {
				const meal = ctx.slotOf(target);
				if (meal === NONE || meal === actor || !food.has(meal)) return FAIL;
				if (((edible.class[meal] ?? 0) & (diet.eats[actor] ?? 0)) === 0)
					return FAIL;
				const dx = ctx.x(meal) - ctx.x(actor);
				const dy = ctx.y(meal) - ctx.y(actor);
				const dist = Math.max(Math.abs(dx), Math.abs(dy));
				if (dist > 1) {
					const cell = ctx.approach(actor, ctx.x(meal), ctx.y(meal));
					// Blocked for now, not wrong: the decision stands and the turn passes.
					return cell === NO_CELL
						? ctx.instead(ctx.idle, null)
						: ctx.instead(ctx.step, cell);
				}
				const full =
					(satiety.value[actor] ?? 0) + (edible.nutrition[meal] ?? 0);
				satiety.value[actor] = Math.min(cfg.max, full);
				const eater = ctx.idOf(actor);
				ctx.emit(ate, eater, target, edible.nutrition[meal] ?? 0);
				ctx.kill(target, eater);
				return cfg.eatCost;
			},
		);

		b.propose((_ctx, actor, perception, out) => {
			if (!fed.has(actor)) return;
			const level = satiety.value[actor] ?? 0;
			if (level >= cfg.hungryBelow) return;
			const eats = diet.eats[actor] ?? 0;
			if (eats === 0) return;
			const score =
				cfg.scoreBase +
				Math.floor((cfg.hungryBelow - level) / cfg.scoreStep) *
					cfg.scorePerStep;
			for (let i = 0; i < perception.count; i++) {
				const meal = perception.slot(i);
				if (!food.has(meal) || ((edible.class[meal] ?? 0) & eats) === 0)
					continue;
				out.push(eat, perception.id(i), score);
				return;
			}
		});
	},
});
