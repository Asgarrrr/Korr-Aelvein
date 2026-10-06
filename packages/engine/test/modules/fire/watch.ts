import { defineModule } from "../../../src/core/api";

export const watch = defineModule({
	name: "watch",
	schema: { feel: { left: "u8", source: "entity" } },
	config: {},
	setup(b) {
		const burning = b.read("fire");
		const feel = b.write("feel");
		const rows = b.query(["feel"]);
		b.tick((ctx) => {
			const list = rows.slots(ctx);
			for (let i = 0; i < list.length; i++) {
				const s = list.at(i);
				const cell = ctx.cellAt(ctx.x(s), ctx.y(s));
				feel.left[s] = burning ? burning.left.read(ctx).get(cell) : 0;
				feel.source[s] = burning ? burning.source.read(ctx).get(cell) : 0;
			}
		});
	},
});

export const WATCHER = { actor: false, components: { feel: {} } };
