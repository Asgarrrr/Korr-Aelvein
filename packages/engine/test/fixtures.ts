import { species } from "../src/content/species";
import { cheese } from "../src/content/species/cheese";
import { rat } from "../src/content/species/rat";
import {
	type AnyModule,
	type Builder,
	defineModule,
	type EntityId,
	type ModuleDef,
	NONE,
	type Schema,
	type Slot,
	type SpeciesShape,
	type WriteCtx,
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

type CoreCtx = WriteCtx & {
	readonly floor: number;
	checkWritable(what: string): void;
	inTickOf(module: number): boolean;
};

function backwards(ctx: WriteCtx): WriteCtx {
	const real = ctx as CoreCtx;
	const before = new Map<Slot, Slot>();
	const flipped: CoreCtx = {
		get floor() {
			return real.floor;
		},
		checkWritable: (what) => real.checkWritable(what),
		inTickOf: (module) => real.inTickOf(module),
		step: real.step,
		idle: real.idle,
		travel: real.travel,
		width: real.width,
		height: real.height,
		isAlive: (id) => real.isAlive(id),
		slotOf: (id) => real.slotOf(id),
		idOf: (slot) => real.idOf(slot),
		x: (slot) => real.x(slot),
		y: (slot) => real.y(slot),
		cellAt: (x, y) => real.cellAt(x, y),
		holdsActor: (cell) => real.holdsActor(cell),
		approach: (actor, x, y) => real.approach(actor, x, y),
		rng: (subject, n, bound) => real.rng(subject, n, bound),
		rngCell: (cell, n, bound) => real.rngCell(cell, n, bound),
		kill: (id, cause) => real.kill(id, cause),
		harm: (target, amount, cause) => real.harm(target, amount, cause),
		spawn: (species, x, y, cause) => real.spawn(species, x, y, cause),
		emit: (event, cause, a, b) => real.emit(event, cause, a, b),
		firstAt(cell) {
			let last = NONE;
			for (let s = real.firstAt(cell); s !== NONE; s = real.nextAt(s)) {
				before.set(s, last);
				last = s;
			}
			return last;
		},
		nextAt: (slot) => before.get(slot) ?? NONE,
	};
	return flipped;
}

// Same module, same name and RNG keys, but every query lists its rows last to first and
// every tick walks each cell's occupants last to first.
export function reversed<S extends Schema, C, K extends Schema>(
	module: ModuleDef<S, C, K>,
): ModuleDef<S, C, K> {
	return {
		...module,
		setup(b, cfg) {
			const flipped: Builder<S, K> = {
				write: (name) => b.write(name),
				cells: (name) => b.cells(name),
				previous: (name) => b.previous(name),
				read: (name) => b.read(name),
				tick: (run) => b.tick((ctx) => run(backwards(ctx))),
				action: (name, kind, requires, run) =>
					b.action(name, kind, requires, run),
				propose: (run) => b.propose(run),
				event: (name) => b.event(name),
				species: (wanted) => b.species(wanted),
				query(names) {
					const inner = b.query(names);
					return {
						has: (slot) => inner.has(slot),
						slots(ctx) {
							const list = inner.slots(ctx);
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
		b.tick((ctx) => {
			const list = rows.slots(ctx);
			for (let i = 0; i < list.length; i++) {
				const s = list.at(i);
				where.x[s] = ctx.x(s);
				where.y[s] = ctx.y(s);
			}
		});
	},
});

// Counts each actor's full decisions: propose runs only when the core arbitrates.
export const decisions = new Map<number, number>();
export const decider = defineModule({
	name: "decider",
	schema: {},
	config: {},
	setup(b) {
		b.propose((ctx, actor) => {
			const id = ctx.idOf(actor);
			decisions.set(id, (decisions.get(id) ?? 0) + 1);
		});
	},
});

export function idleRounds(
	world: {
		advance(): readonly EntityId[];
		input(player: EntityId, action: string, target: number | null): void;
	},
	rounds: number,
): void {
	for (let r = 0; r < rounds; r++)
		for (let due = world.advance(); due.length > 0; due = world.advance())
			for (const p of due) world.input(p, "core/idle", null);
}
