// Checked by `tsc` only: each @ts-expect-error fails the typecheck if its line compiles.
import { defineModule, type EntityId, type Slot } from "../../src/core/api";
import type { Species } from "../../src/core/lifecycle/species";
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

defineModule({
	name: "reader",
	schema: {},
	config: {},
	setup(b) {
		const diet = b.read("diet");
		if (!diet) return;
		b.propose((_ctx, actor) => {
			diet.eats.get(actor);
			// @ts-expect-error a read view has no component mask
			diet.has(actor);
			// @ts-expect-error a read view has no writable index
			diet.eats[actor] = 1;
			// @ts-expect-error a read view is not a TypedArray
			const raw: Uint8Array = diet.eats;
			return raw;
		});
		// @ts-expect-error satiety is not in contracts/
		b.read("satiety");
	},
});

defineModule({
	name: "fireReader",
	schema: {},
	cells: { glow: { v: "u8" } },
	config: {},
	setup(b) {
		const was = b.previous("glow");
		// @ts-expect-error only owned cells are buffered
		b.previous("fire");
		const fire = b.read("fire");
		b.query(["vitality"]);
		// @ts-expect-error vitality is core-owned: no module writes it
		b.write("vitality");
		b.tick((ctx) => {
			const cell = ctx.cellAt(0, 0);
			was.v.read(ctx).get(cell);
			// @ts-expect-error a previous buffer is read-only
			was.v.write(ctx);
			if (!fire) return;
			const source: EntityId = fire.source.read(ctx).get(cell);
			ctx.harm(source, fire.left.read(ctx).get(cell), source);
			// @ts-expect-error a cell reader reads a cell, not a slot
			fire.left.read(ctx).get(0 as Slot);
			// @ts-expect-error a contract cell view has no writer
			fire.left.write(ctx);
		});
	},
});
