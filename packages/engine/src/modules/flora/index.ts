import { defineModule } from "../../core/module/api";
import { floraConfig } from "./config";
import { schema } from "./schema";

export const flora = defineModule({
	name: "flora",
	schema,
	sparse: ["sprout"],
	config: floraConfig,
	setup(b, cfg) {
		const sprout = b.sparse("sprout");
		const plants = b.query(["sprout"]);
		const yields = b.species(cfg.yields);

		b.tick((ctx) => {
			const rows = plants.slots(ctx);
			const { period, left } = sprout.columns;
			for (let i = 0; i < rows.length; i++) {
				const s = rows.at(i);
				const r = sprout.row(s);
				const next = (left[r] ?? 0) - 1;
				if (next > 0) {
					left[r] = next;
					continue;
				}
				left[r] = period[r] ?? 0;
				ctx.spawn(yields, ctx.x(s), ctx.y(s), ctx.idOf(s));
			}
		});
	},
});
