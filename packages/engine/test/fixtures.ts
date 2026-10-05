import { species } from "../src/content/species";
import { cheese } from "../src/content/species/cheese";
import { rat } from "../src/content/species/rat";
import {
	type AnyModule,
	type Builder,
	defineModule,
	type ModuleDef,
	type Schema,
	type SpeciesShape,
} from "../src/core/api";
import { createWorld } from "../src/core/world";
import { modules } from "../src/registry";

export const SIZE = 32;

// The game's registry and the species table its modules name.
export const game = { modules, species } as const;

export function populatedWorld(
	seed: number,
	modules: readonly AnyModule[],
	count = 50,
	options: {
		popCap?: number;
		events?: boolean;
		audit?: boolean;
		species?: Readonly<Record<string, SpeciesShape>>;
	} = {},
) {
	const world = createWorld({
		seed,
		floors: 1,
		width: SIZE,
		height: SIZE,
		modules,
		species,
		...options,
	});
	const rats = [];
	for (let i = 0; i < count; i++) {
		rats.push(world.spawn(0, rat, (i % 10) * 3, Math.floor(i / 10) * 6));
		world.spawn(0, cheese, (i * 5 + 3) % SIZE, (i * 3 + 1) % SIZE);
	}
	return { world, rats };
}

// Same module, same name and RNG keys, but every query lists its rows last to first.
export function reversed<S extends Schema, C, K extends Schema>(
	module: ModuleDef<S, C, K>,
): ModuleDef<S, C, K> {
	return {
		...module,
		setup(b, cfg) {
			const flipped: Builder<S, K> = {
				write: (name) => b.write(name),
				cells: (name) => b.cells(name),
				read: (name) => b.read(name),
				tick: (run) => b.tick(run),
				action: (name, kind, run) => b.action(name, kind, run),
				propose: (run) => b.propose(run),
				event: (name) => b.event(name),
				species: (wanted) => b.species(wanted),
				query(names) {
					const inner = b.query(names);
					return {
						has: (slot) => inner.has(slot),
						slots(floor) {
							const list = inner.slots(floor);
							const last = list.length - 1;
							return { length: list.length, at: (i) => list.at(last - i) };
						},
					};
				},
			};
			module.setup(flipped, cfg);
		},
	};
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
