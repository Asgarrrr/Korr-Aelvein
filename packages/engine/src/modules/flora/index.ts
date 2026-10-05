import { defineModule } from "../../core/api";
import { floraConfig } from "./config";
import { schema } from "./schema";

export const flora = defineModule({
	name: "flora",
	schema,
	config: floraConfig,
	setup(b, cfg) {
		const sprout = b.write("sprout");
		const plants = b.query(["sprout"]);
		const yields = b.species(cfg.yields);

		b.tick((ctx, floor) => {
			const rows = plants.slots(floor);
			const { period, left } = sprout;
			for (let i = 0; i < rows.length; i++) {
				const s = rows.at(i);
				const next = (left[s] ?? 0) - 1;
				if (next > 0) {
					left[s] = next;
					continue;
				}
				left[s] = period[s] ?? 0;
				ctx.spawn(yields, ctx.x(s), ctx.y(s), ctx.idOf(s));
			}
		});
	},
});
