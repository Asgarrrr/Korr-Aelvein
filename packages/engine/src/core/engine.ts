import {
	type ActionFn,
	type ActionRef,
	ALTERNATE,
	FAIL,
	type ProposeFn,
	type TargetKind,
	type TargetOf,
	type TickFn,
} from "./api";
import { CandidateBuffer } from "./candidates";
import { MAX_ALTERNATES, MAX_TICK, TICKS_PER_TURN } from "./config";
import { Context } from "./context";
import { DeferredKills, DeferredSpawns } from "./deferred";
import { Grid } from "./grid";
import { type Cell, type EntityId, NO_CELL, NONE, type Slot } from "./ids";
import { PerceptionBuffer } from "./perception";
import { hashName, PHASE } from "./rng";
import { Scheduler } from "./scheduler";
import type { Column } from "./schema";
import type { SpeciesShape } from "./species";
import { ACTOR, type MaskBit, Storage } from "./storage";

const KIND_CODE: Readonly<Record<TargetKind, number>> = {
	none: 0,
	entity: 1,
	cell: 2,
};

interface Component {
	readonly bit: MaskBit;
	readonly columns: Readonly<Record<string, Column>>;
}

export interface ActionEntry {
	readonly key: number;
	readonly kind: number;
	readonly moduleKey: number;
	readonly run: ActionFn<TargetKind>;
}

interface Hook<F> {
	readonly moduleKey: number;
	readonly run: F;
}

export interface EngineOptions {
	readonly seed: number;
	readonly floors: number;
	readonly width: number;
	readonly height: number;
	readonly componentCount: number;
}

export const CORE = "core";
export const CORE_KEY = hashName(CORE);
const NO_ACTION = -1;

export class Engine {
	readonly seed: number;
	readonly storage: Storage;
	readonly grid: Grid;
	readonly scheduler: Scheduler;
	readonly now: Int32Array;
	round = 0;

	readonly components = new Map<string, Component>();
	readonly actions: ActionEntry[] = [];
	readonly ticks: Hook<TickFn>[] = [];
	readonly proposers: Hook<ProposeFn>[] = [];

	readonly kills = new DeferredKills();
	readonly spawns = new DeferredSpawns();
	private readonly perception: PerceptionBuffer;
	private readonly candidates: CandidateBuffer;
	private readonly tickCtx: Context;
	private readonly proposeCtx: Context;
	private readonly actionCtx: Context;
	private readonly idleIndex: number;
	private alternate = NO_ACTION;
	private alternateTarget = 0;

	constructor(options: EngineOptions) {
		this.seed = options.seed;
		this.storage = new Storage(options.floors, options.componentCount);
		this.grid = new Grid(this.storage, options.width, options.height);
		this.scheduler = new Scheduler(this.storage);
		this.now = new Int32Array(options.floors);
		this.perception = new PerceptionBuffer(this.grid, this.storage.ids);
		this.candidates = new CandidateBuffer(this.actions);

		const step = this.addAction(
			CORE_KEY,
			hashName(`${CORE}/step`),
			"cell",
			(_ctx, actor, cell) => this.step(actor, cell),
		);
		const idle = this.addAction(
			CORE_KEY,
			hashName(`${CORE}/idle`),
			"none",
			() => TICKS_PER_TURN,
		);
		this.idleIndex = idle.index;
		this.tickCtx = new Context(this, PHASE.tick, step, idle);
		this.proposeCtx = new Context(this, PHASE.propose, step, idle);
		this.actionCtx = new Context(this, PHASE.action, step, idle);
	}

	addAction<K extends TargetKind>(
		moduleKey: number,
		key: number,
		kind: K,
		run: ActionFn<K>,
	): ActionRef<K> {
		if (this.actions.some((a) => a.key === key))
			throw new Error(`duplicate action key ${key}`);
		const index = this.actions.length;
		this.actions.push({
			key,
			kind: KIND_CODE[kind],
			moduleKey,
			run: run as ActionFn<TargetKind>,
		});
		return { index } as ActionRef<K>;
	}

	setAlternate(action: number, target: number): void {
		this.alternate = action;
		this.alternateTarget = target;
	}

	runRound(): void {
		for (let f = 0; f < this.storage.floors; f++) this.runFloor(f);
		this.round++;
	}

	spawn(
		floor: number,
		species: SpeciesShape,
		x: number,
		y: number,
		at: number,
	): EntityId {
		const cell = this.checkSpawn(floor, species, x, y);
		if (species.actor && this.grid.holdsOtherActor(floor, cell, NONE))
			throw new Error(`spawn at (${x}, ${y}): the cell holds an actor`);
		return this.place(floor, species, x, y, at);
	}

	checkSpawn(floor: number, species: SpeciesShape, x: number, y: number): Cell {
		if (!(Number.isInteger(floor) && floor >= 0 && floor < this.storage.floors))
			throw new Error(`no floor ${floor}`);
		const cell = this.grid.cellAt(x, y);
		if (cell === NO_CELL)
			throw new Error(`spawn at (${x}, ${y}) is outside the floor`);
		for (const name in species.components) {
			const component = this.components.get(name);
			if (!component) continue;
			const values = species.components[name];
			for (const field in values) {
				if (!component.columns[field])
					throw new Error(`${name} has no field ${field}`);
				if (!Number.isInteger(values[field]))
					throw new Error(`${name}.${field} is not an integer`);
			}
		}
		return cell;
	}

	private place(
		floor: number,
		species: SpeciesShape,
		x: number,
		y: number,
		at: number,
	): EntityId {
		if (species.actor && at > MAX_TICK)
			throw new Error(`time ${at} exceeds ${MAX_TICK}`);
		const storage = this.storage;
		const slot = storage.alloc(floor);
		this.grid.insert(floor, slot, x, y);
		const masks = storage.masks;
		const base = slot * storage.maskWords;
		for (const name in species.components) {
			// A species may name components of modules this world does not register.
			const component = this.components.get(name);
			if (!component) continue;
			masks[base + component.bit.word] =
				(masks[base + component.bit.word] ?? 0) | component.bit.bit;
			const values = species.components[name];
			for (const field in values)
				(component.columns[field] as Column)[slot] = values[field] ?? 0;
		}
		if (species.actor) {
			masks[base] = (masks[base] ?? 0) | ACTOR;
			this.scheduler.nextAt[slot] = at;
			this.scheduler.push(floor, slot);
		}
		return (storage.ids[slot] ?? 0) as EntityId;
	}

	private kill(floor: number, id: EntityId): void {
		const slot = this.storage.slotOf(floor, id);
		if (slot === NONE) return;
		this.grid.remove(floor, slot);
		this.scheduler.remove(floor, slot);
		this.storage.release(floor, slot);
	}

	private runFloor(floor: number): void {
		const start = this.round * TICKS_PER_TURN;
		const end = start + TICKS_PER_TURN;
		this.now[floor] = start;

		const tickCtx = this.tickCtx;
		tickCtx.floor = floor;
		for (let i = 0; i < this.ticks.length; i++) {
			const tick = this.ticks[i] as Hook<TickFn>;
			tickCtx.module = tick.moduleKey;
			tick.run(tickCtx, floor);
			this.applyDeferred(floor);
		}

		const scheduler = this.scheduler;
		const ids = this.storage.ids;
		while (scheduler.size(floor) > 0 && scheduler.topTime(floor) < end) {
			const slot = scheduler.top(floor);
			const time = scheduler.nextAt[slot] ?? 0;
			const id = (ids[slot] ?? 0) as EntityId;
			this.now[floor] = time;
			const cost = this.act(floor, slot);
			this.applyDeferred(floor);
			if (ids[slot] !== id) continue;
			if (time + cost > MAX_TICK)
				throw new Error(`time ${time + cost} exceeds ${MAX_TICK}`);
			scheduler.delay(floor, slot, time + cost);
		}
		this.now[floor] = end;
	}

	private act(floor: number, slot: Slot): number {
		this.perception.reset(floor, slot);
		const out = this.candidates;
		out.count = 0;
		const ctx = this.proposeCtx;
		ctx.floor = floor;
		for (let i = 0; i < this.proposers.length; i++) {
			const proposer = this.proposers[i] as Hook<ProposeFn>;
			ctx.module = proposer.moduleKey;
			proposer.run(ctx, slot, this.perception, out);
		}
		if (out.count === 0) return this.execute(floor, slot, this.idleIndex, 0);
		const best = out.best();
		return this.execute(
			floor,
			slot,
			out.action[best] ?? 0,
			out.target[best] ?? 0,
		);
	}

	private execute(
		floor: number,
		slot: Slot,
		first: number,
		firstTarget: number,
	): number {
		const ctx = this.actionCtx;
		ctx.floor = floor;
		let action = first;
		let target = firstTarget;
		for (let depth = 0; ; depth++) {
			const entry = this.actions[action] as ActionEntry;
			ctx.module = entry.moduleKey;
			this.alternate = NO_ACTION;
			const decoded = entry.kind === KIND_CODE.none ? null : target;
			const result = entry.run(ctx, slot, decoded as TargetOf[TargetKind]);
			if (result === FAIL) return TICKS_PER_TURN;
			if (result !== ALTERNATE) {
				if (!Number.isInteger(result) || result < 1)
					throw new Error(`action cost ${result} is not an integer >= 1`);
				return result;
			}
			if (this.alternate === NO_ACTION)
				throw new Error("ALTERNATE returned without ctx.instead");
			if (depth === MAX_ALTERNATES)
				throw new Error(`more than ${MAX_ALTERNATES} alternates`);
			action = this.alternate;
			target = this.alternateTarget;
		}
	}

	private step(actor: Slot, cell: Cell): number {
		if (cell === NO_CELL) return FAIL;
		const grid = this.grid;
		if (cell < 0 || cell >= grid.cells)
			throw new Error(`cell ${cell} is outside the floor`);
		const dx = Math.abs((cell % grid.width) - (grid.x[actor] ?? 0));
		const dy = Math.abs(((cell / grid.width) | 0) - (grid.y[actor] ?? 0));
		if ((dx > dy ? dx : dy) !== 1) return FAIL;
		const floor = this.actionCtx.floor;
		if (grid.holdsOtherActor(floor, cell, actor)) return FAIL;
		grid.move(floor, actor, cell);
		return TICKS_PER_TURN;
	}

	private applyDeferred(floor: number): void {
		const kills = this.kills;
		if (kills.count > 0) {
			try {
				kills.sort();
				for (let i = 0; i < kills.count; i++)
					this.kill(floor, (kills.ids[kills.order[i] ?? 0] ?? 0) as EntityId);
			} finally {
				kills.count = 0;
			}
		}
		const spawns = this.spawns;
		if (spawns.count > 0) {
			try {
				spawns.sort();
				const at = (this.now[floor] ?? 0) + TICKS_PER_TURN;
				const grid = this.grid;
				for (let i = 0; i < spawns.count; i++) {
					const n = spawns.order[i] ?? 0;
					const species = spawns.species[n] as SpeciesShape;
					const x = spawns.xs[n] ?? 0;
					const y = spawns.ys[n] ?? 0;
					// Refused, not thrown: the batch is sorted, so which spawn loses is deterministic.
					if (
						species.actor &&
						grid.holdsOtherActor(floor, grid.cellAt(x, y), NONE)
					)
						continue;
					this.place(floor, species, x, y, at);
				}
			} finally {
				spawns.species.fill(undefined, 0, spawns.count);
				spawns.count = 0;
			}
		}
	}
}
