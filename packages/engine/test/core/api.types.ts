// Checked by `tsc` only: each @ts-expect-error fails the typecheck if its line compiles.
import { defineModule } from "../../src/core/api";
import type { Species } from "../../src/core/species";
import { createWorld } from "../../src/core/world";
import { modules } from "../../src/registry";

defineModule({
	name: "typed",
	schema: { owned: { value: "i32" } },
	config: {},
	setup(b) {
		b.write("owned");
		// @ts-expect-error satiety belongs to hunger
		b.write("satiety");
		// @ts-expect-error unknown field of an owned component
		b.write("owned").missing;
		const bite = b.action("bite", "entity", () => 100);
		b.propose((ctx, actor, perception, out) => {
			out.push(bite, perception.id(0), 1);
			// @ts-expect-error a raw number is not an EntityId
			out.push(bite, 42, 1);
			// @ts-expect-error a slot is not an EntityId
			out.push(bite, actor, 1);
			// @ts-expect-error a cell is not an EntityId
			out.push(bite, ctx.cellAt(0, 0), 1);
			out.push(ctx.step, ctx.cellAt(0, 0), 1);
			// @ts-expect-error a raw number is not a Cell
			out.push(ctx.step, 3, 1);
		});
	},
});

export const known = {
	actor: true,
	components: { satiety: { value: 1 }, edible: { nutrition: 2 } },
} satisfies Species<typeof modules>;

export const unknownComponent = {
	actor: true,
	// @ts-expect-error wings is not a registered component
	components: { wings: { span: 2 } },
} satisfies Species<typeof modules>;

export const unknownField = {
	actor: true,
	// @ts-expect-error satiety has no field level
	components: { satiety: { level: 2 } },
} satisfies Species<typeof modules>;

const world = createWorld({ seed: 1, floors: 1, width: 4, height: 4, modules });
// @ts-expect-error wings is not a registered component
world.spawn(0, { actor: true, components: { wings: {} } }, 0, 0);
