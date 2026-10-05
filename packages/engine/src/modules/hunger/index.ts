import { defineModule, FAIL, NONE } from "../../core/api";
import { hungerConfig } from "./config";
import { schema } from "./schema";

export const hunger = defineModule({
	name: "hunger",
	schema,
	config: hungerConfig,
	setup(b, cfg) {
		const satiety = b.write("satiety");
		const edible = b.write("edible");
		const fed = b.query(["satiety"]);
		const food = b.query(["edible"]);
		const ate = b.event("ate");

		b.tick((ctx, floor) => {
			const rows = fed.slots(floor);
			const value = satiety.value;
			const decay = cfg.decayPerTurn;
			for (let i = 0; i < rows.length; i++) {
				const s = rows.at(i);
				const left = (value[s] ?? 0) - decay;
				value[s] = left;
				if (left <= 0) ctx.kill(ctx.idOf(s), ctx.idOf(s));
			}
		});

		const eat = b.action("eat", "entity", (ctx, actor, target) => {
			const meal = ctx.slotOf(target);
			if (meal === NONE || !food.has(meal)) return FAIL;
			const dx = ctx.x(meal) - ctx.x(actor);
			const dy = ctx.y(meal) - ctx.y(actor);
			if (Math.max(Math.abs(dx), Math.abs(dy)) > 1) return FAIL;
			const full = (satiety.value[actor] ?? 0) + (edible.nutrition[meal] ?? 0);
			satiety.value[actor] = Math.min(cfg.max, full);
			const eater = ctx.idOf(actor);
			ctx.emit(ate, eater, target, edible.nutrition[meal] ?? 0);
			ctx.kill(target, eater);
			return cfg.eatCost;
		});

		b.propose((ctx, actor, perception, out) => {
			if (!fed.has(actor)) return;
			const level = satiety.value[actor] ?? 0;
			if (level >= cfg.hungryBelow) return;
			const score =
				cfg.scoreBase +
				Math.floor((cfg.hungryBelow - level) / cfg.scoreStep) *
					cfg.scorePerStep;
			for (let i = 0; i < perception.count; i++) {
				if (!food.has(perception.slot(i))) continue;
				if (perception.dist(i) <= 1) {
					out.push(eat, perception.id(i), score);
				} else {
					const x = ctx.x(actor) + Math.sign(perception.dx(i));
					const y = ctx.y(actor) + Math.sign(perception.dy(i));
					out.push(ctx.step, ctx.cellAt(x, y), score);
				}
				return;
			}
		});
	},
});
