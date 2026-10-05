import { expect, test } from "bun:test";
import { defineModule } from "../../../src/core/api";
import { createWorld } from "../../../src/core/world";

test("a query with no component lists live rows only, never a freed slot", () => {
	const lengths: number[] = [];
	const census = defineModule({
		name: "census",
		schema: {},
		config: {},
		setup(b) {
			const all = b.query([]);
			b.tick((ctx) => {
				const list = all.slots(ctx);
				lengths.push(list.length);
				if (list.length === 2)
					ctx.kill(ctx.idOf(list.at(1)), ctx.idOf(list.at(1)));
			});
		},
	});
	const world = createWorld({
		seed: 1,
		floors: 1,
		width: 4,
		height: 4,
		modules: [census],
	});
	world.spawn(0, { actor: false, components: {} }, 0, 0);
	world.spawn(0, { actor: false, components: {} }, 1, 0);
	world.runRounds(2);
	expect(lengths).toEqual([2, 1]);
});
