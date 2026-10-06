import { CAP } from "../src/core/config";
import type { Engine } from "../src/core/engine";
import { UNNAMED } from "../src/core/lifecycle/species";
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
} from "../src/core/module/api";
import { saveWorld } from "../src/core/persistence/save";
import { createWorld, loadEngine } from "../src/core/world/world";
import { game } from "../src/game";

export const SIZE = 32;

export { game };

// A game save with every species index cleared: what the same spawns by shape would save.
export function unnamed(bytes: Uint8Array): Uint8Array {
	const engine = loadEngine(bytes, game);
	engine.speciesIndex.fill(UNNAMED);
	return saveWorld(engine);
}

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
		species: game.species,
		...options,
	});
	const rats = [];
	for (let i = 0; i < count; i++) {
		rats.push(world.spawn(0, "rat", (i % 10) * 3, Math.floor(i / 10) * 6));
		world.spawn(0, "cheese", (i * 5 + 3) % SIZE, (i * 3 + 1) % SIZE);
	}
	return { world, rats };
}

type CoreCtx = WriteCtx & {
	readonly floor: number;
	checkWritable(what: string): void;
	inTickOf(module: number): boolean;
};

// A wrapper spreads this and overrides what it changes: a new WriteCtx member goes here only.
function forwardCtx(ctx: WriteCtx): WriteCtx {
	return {
		step: ctx.step,
		idle: ctx.idle,
		travel: ctx.travel,
		width: ctx.width,
		height: ctx.height,
		isAlive: (id) => ctx.isAlive(id),
		slotOf: (id) => ctx.slotOf(id),
		idOf: (slot) => ctx.idOf(slot),
		x: (slot) => ctx.x(slot),
		y: (slot) => ctx.y(slot),
		cellAt: (x, y) => ctx.cellAt(x, y),
		cellOf: (slot) => ctx.cellOf(slot),
		holdsActor: (cell) => ctx.holdsActor(cell),
		approach: (actor, x, y) => ctx.approach(actor, x, y),
		firstAt: (cell) => ctx.firstAt(cell),
		nextAt: (slot) => ctx.nextAt(slot),
		rng: (subject, n, bound) => ctx.rng(subject, n, bound),
		rngCell: (cell, n, bound) => ctx.rngCell(cell, n, bound),
		kill: (id, cause) => ctx.kill(id, cause),
		harm: (target, amount, cause) => ctx.harm(target, amount, cause),
		spawn: (species, x, y, cause) => ctx.spawn(species, x, y, cause),
		emit: (event, cause, a, b) => ctx.emit(event, cause, a, b),
	};
}

// As forwardCtx, for a new Builder member.
export function forwardBuilder<S extends Schema, K extends Schema>(
	b: Builder<S, K>,
): Builder<S, K> {
	return {
		write: (name) => b.write(name),
		cells: (name) => b.cells(name),
		previous: (name) => b.previous(name),
		read: (name) => b.read(name),
		query: (names) => b.query(names),
		tick: (run) => b.tick(run),
		action: (name, kind, requires, run) => b.action(name, kind, requires, run),
		propose: (run) => b.propose(run),
		alarm: (field, requires) => b.alarm(field, requires),
		event: (name) => b.event(name),
		species: (wanted) => b.species(wanted),
	};
}

function backwards(ctx: WriteCtx): WriteCtx {
	const real = ctx as CoreCtx;
	const before = new Map<Slot, Slot>();
	const flipped: CoreCtx = {
		...forwardCtx(real),
		get floor() {
			return real.floor;
		},
		checkWritable: (what) => real.checkWritable(what),
		inTickOf: (module) => real.inTickOf(module),
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
				...forwardBuilder(b),
				tick: (run) => b.tick((ctx) => run(backwards(ctx))),
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

// Calls `change` for every intent change of an entity after its first decision.
function intentChanges(
	engine: Engine,
	rounds: number,
	change: (
		slot: number,
		id: number,
		from: readonly [number, number],
		to: readonly [number, number],
		round: number,
	) => void,
): void {
	const { ids, highWater, floors } = engine.storage;
	const { intentKey, intentTarget } = engine;
	const lastId = new Int32Array(ids.length);
	const lastKey = new Int32Array(ids.length);
	const lastTarget = new Int32Array(ids.length);
	const decided = new Uint8Array(ids.length);
	for (let r = 0; r <= rounds; r++) {
		if (r > 0) engine.runRound();
		for (let f = 0; f < floors; f++)
			for (let s = f * CAP; s < f * CAP + (highWater[f] ?? 0); s++) {
				const id = ids[s] ?? 0;
				const key = intentKey[s] ?? 0;
				const target = intentTarget[s] ?? 0;
				if (id !== lastId[s]) decided[s] = 0;
				else if (
					decided[s] === 1 &&
					(key !== lastKey[s] || target !== lastTarget[s])
				)
					change(
						s,
						id,
						[lastKey[s] ?? 0, lastTarget[s] ?? 0],
						[key, target],
						r,
					);
				if (key !== 0) decided[s] = 1;
				lastId[s] = id;
				lastKey[s] = key;
				lastTarget[s] = target;
			}
	}
}

// Oscillation measure: an entity's first decision is not a switch, only later changes are.
export function intentSwitches(engine: Engine, rounds: number): number {
	let switches = 0;
	intentChanges(engine, rounds, () => switches++);
	return switches;
}

const REVERSAL_ROUNDS = 2;

// Jitter measure: a switch back to the intent held before the previous switch (A to B to A),
// at most REVERSAL_ROUNDS rounds after it.
export function intentReversals(engine: Engine, rounds: number): number {
	const size = engine.storage.ids.length;
	const backId = new Int32Array(size);
	const backKey = new Int32Array(size);
	const backTarget = new Int32Array(size);
	const backRound = new Int32Array(size);
	let reversals = 0;
	intentChanges(engine, rounds, (s, id, from, to, round) => {
		if (
			backId[s] === id &&
			round - (backRound[s] ?? 0) <= REVERSAL_ROUNDS &&
			backKey[s] === to[0] &&
			backTarget[s] === to[1]
		)
			reversals++;
		backId[s] = id;
		backKey[s] = from[0];
		backTarget[s] = from[1];
		backRound[s] = round;
	});
	return reversals;
}
