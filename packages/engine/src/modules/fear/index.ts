import { defineModule } from "../../core/module/api";
import { defineAvoid } from "./behaviours/avoid";
import { defineFlee } from "./behaviours/flee";
import { defineWatch } from "./behaviours/watch";
import { fearConfig } from "./config";
import { cells, schema } from "./schema";
import { senseFear } from "./sense";
import { newSituation } from "./situation";
import { stampFear } from "./stamps";

export const fear = defineModule({
	name: "fear",
	schema,
	cells,
	config: fearConfig,
	setup(b, cfg) {
		const sense = senseFear(b, cfg);
		// Far floors replay for up to 64 turns; this makes a wary creature decide again when danger
		// first reaches its cell.
		b.alarm("alarm", "eats", ["wary"]);
		b.tick(stampFear(b, cfg));
		const flee = defineFlee(b, sense, cfg);
		const watch = defineWatch(b, sense, cfg);
		const avoid = defineAvoid(b, sense, cfg);
		const situation = newSituation();
		b.propose((ctx, actor, _perception, out) => {
			if (!sense.wary(actor) || !sense.fill(ctx, actor, situation)) return;
			// Order is irrelevant: the core breaks ties on action keys.
			watch(ctx, actor, situation, out);
			flee(ctx, actor, situation, out);
			avoid(ctx, actor, situation, out);
		});
	},
});
