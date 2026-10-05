import {
	type Cell,
	defineModule,
	FAIL,
	NO_CELL,
	NONE,
	type ReadCtx,
	type Slot,
} from "../../core/api";
import { hungerConfig } from "./config";
import { schema } from "./schema";

const DX = [-1, 0, 1, -1, 1, -1, 0, 1];
const DY = [-1, -1, -1, 0, 0, 1, 1, 1];

// The straight step toward the meal first, then any other free step that also closes in.
function approach(
	ctx: ReadCtx,
	actor: Slot,
	dx: number,
	dy: number,
	dist: number,
): Cell {
	const x = ctx.x(actor);
	const y = ctx.y(actor);
	const sx = Math.sign(dx);
	const sy = Math.sign(dy);
	const straight = ctx.cellAt(x + sx, y + sy);
	if (!ctx.holdsActor(straight)) return straight;
	for (let d = 0; d < DX.length; d++) {
		const ox = DX[d] ?? 0;
		const oy = DY[d] ?? 0;
		if (ox === sx && oy === sy) continue;
		if (Math.max(Math.abs(dx - ox), Math.abs(dy - oy)) !== dist - 1) continue;
		const cell = ctx.cellAt(x + ox, y + oy);
		if (cell !== NO_CELL && !ctx.holdsActor(cell)) return cell;
	}
	return NO_CELL;
}

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
			if (meal === NONE || meal === actor || !food.has(meal)) return FAIL;
			if (((edible.class[meal] ?? 0) & (diet.eats[actor] ?? 0)) === 0)
				return FAIL;
			const dx = ctx.x(meal) - ctx.x(actor);
			const dy = ctx.y(meal) - ctx.y(actor);
			const dist = Math.max(Math.abs(dx), Math.abs(dy));
			if (dist > 1) {
				const cell = approach(ctx, actor, dx, dy, dist);
				return cell === NO_CELL ? FAIL : ctx.instead(ctx.step, cell);
			}
			const full = (satiety.value[actor] ?? 0) + (edible.nutrition[meal] ?? 0);
			satiety.value[actor] = Math.min(cfg.max, full);
			const eater = ctx.idOf(actor);
			ctx.emit(ate, eater, target, edible.nutrition[meal] ?? 0);
			ctx.kill(target, eater);
			return cfg.eatCost;
		});

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
