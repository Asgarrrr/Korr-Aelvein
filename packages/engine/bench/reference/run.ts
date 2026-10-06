import type { AnyModule, Builder, ModuleDef, Schema } from "../../src/core/api";
import { NONE } from "../../src/core/ecs/ids";
import { type Engine, FLOOR_STAGE } from "../../src/core/engine";
import { advance, playerTurn, startRound } from "../../src/core/turns/round";
import { beginFloor, runActors } from "../../src/core/turns/turn";

export class TickClock {
	readonly spent: Float64Array;
	readonly ticks: boolean[];
	constructor(readonly names: readonly string[]) {
		this.spent = new Float64Array(names.length);
		this.ticks = names.map(() => false);
	}
}

function timed<S extends Schema, C, K extends Schema>(
	module: ModuleDef<S, C, K>,
	clock: TickClock,
	m: number,
): ModuleDef<S, C, K> {
	return {
		...module,
		setup(b, cfg) {
			const inner: Builder<S, K> = {
				write: (name) => b.write(name),
				cells: (name) => b.cells(name),
				previous: (name) => b.previous(name),
				read: (name) => b.read(name),
				query: (names) => b.query(names),
				action: (name, kind, requires, run) =>
					b.action(name, kind, requires, run),
				propose: (run) => b.propose(run),
				event: (name) => b.event(name),
				species: (wanted) => b.species(wanted),
				tick: (run) => {
					clock.ticks[m] = true;
					b.tick((ctx) => {
						const start = Bun.nanoseconds();
						run(ctx);
						clock.spent[m] = (clock.spent[m] ?? 0) + Bun.nanoseconds() - start;
					});
				},
			};
			module.setup(inner, cfg);
		},
	};
}

// Same names, schemas and configs, so the world and its hash are unchanged.
export function withClock(list: readonly AnyModule[]) {
	const clock = new TickClock(list.map((m) => m.name));
	return { clock, modules: list.map((m, i) => timed(m, clock, i)) };
}

export interface Round {
	total: number;
	// Per floor: ticks, actors, actor turns run; per floor and module: tick time.
	readonly ticks: Float64Array;
	readonly actors: Float64Array;
	readonly turns: Int32Array;
	readonly moduleTicks: Float64Array;
}

export function newRound(floors: number, modules: number): Round {
	return {
		total: 0,
		ticks: new Float64Array(floors),
		actors: new Float64Array(floors),
		turns: new Int32Array(floors),
		moduleTicks: new Float64Array(floors * modules),
	};
}

// One round as world.advance and world.input run it, every due player idling, floor by floor
// in the engine's floor order so each floor's phases can be timed.
export function playRound(
	e: Engine,
	out?: Round,
	clock?: TickClock,
	counted?: Int32Array,
): void {
	const start = Bun.nanoseconds();
	startRound(e);
	for (const f of e.floorOrder) {
		const before = counted?.[f] ?? 0;
		clock?.spent.fill(0);
		const t0 = Bun.nanoseconds();
		beginFloor(e, f);
		const t1 = Bun.nanoseconds();
		for (let due = runActors(e, f); due !== NONE; due = runActors(e, f))
			playerTurn(e, f, due, e.idleIndex, 0);
		const t2 = Bun.nanoseconds();
		if (!out) continue;
		out.ticks[f] = t1 - t0;
		out.actors[f] = t2 - t1;
		out.turns[f] = (counted?.[f] ?? 0) - before;
		if (clock) out.moduleTicks.set(clock.spent, f * clock.spent.length);
	}
	if (advance(e).length > 0 || e.stage[0] !== FLOOR_STAGE.waiting)
		throw new Error("the round did not close");
	if (out) out.total = Bun.nanoseconds() - start;
}

// Turns each floor has run: a turn ends in its actor's delay, or in the removal of the due
// actor while the floor acts (it died or left). The wrappers' calls are part of every timed turn.
export function countTurns(e: Engine): Int32Array {
	const turns = new Int32Array(e.storage.floors);
	const scheduler = e.scheduler;
	const delay = scheduler.delay.bind(scheduler);
	const remove = scheduler.remove.bind(scheduler);
	scheduler.delay = (floor, slot, at) => {
		turns[floor] = (turns[floor] ?? 0) + 1;
		delay(floor, slot, at);
	};
	scheduler.remove = (floor, slot) => {
		if (e.stage[floor] === FLOOR_STAGE.acting && scheduler.top(floor) === slot)
			turns[floor] = (turns[floor] ?? 0) + 1;
		remove(floor, slot);
	};
	return turns;
}

// What a server does after each round: hand every floor's events to its clients.
export function drainEvents(e: Engine): void {
	for (let f = 0; f < e.storage.floors; f++) e.events.drain(f, () => {});
}
