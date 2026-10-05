import { cheese } from "../src/content/species/cheese";
import { rat } from "../src/content/species/rat";
import { type AnyModule, defineModule } from "../src/core/api";
import { createWorld } from "../src/core/world";

export const SIZE = 32;

export function populatedWorld(
	seed: number,
	modules: readonly AnyModule[],
	count = 50,
) {
	const world = createWorld({
		seed,
		floors: 1,
		width: SIZE,
		height: SIZE,
		modules,
	});
	const rats = [];
	for (let i = 0; i < count; i++) {
		rats.push(world.spawn(0, rat, (i % 10) * 3, Math.floor(i / 10) * 6));
		world.spawn(0, cheese, (i * 5 + 3) % SIZE, (i * 3 + 1) % SIZE);
	}
	return { world, rats };
}

// Records each `where` row's position at the start of every round.
export const probe = defineModule({
	name: "probe",
	schema: { where: { x: "i16", y: "i16" } },
	config: {},
	setup(b) {
		const where = b.write("where");
		const rows = b.query(["where"]);
		b.tick((ctx, floor) => {
			const list = rows.slots(floor);
			for (let i = 0; i < list.length; i++) {
				const s = list.at(i);
				where.x[s] = ctx.x(s);
				where.y[s] = ctx.y(s);
			}
		});
	},
});
