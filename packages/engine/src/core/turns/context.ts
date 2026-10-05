import {
	type ActionCtx,
	type ActionRef,
	ALTERNATE,
	type EventRef,
	type SpeciesRef,
	type TargetKind,
	type TargetOf,
} from "../api";
import { type Cell, type EntityId, NO_CELL, NONE, type Slot } from "../ecs/ids";
import type { ActionEntry, Engine } from "../engine";
import { checkSpawn } from "../lifecycle/lifecycle";
import {
	bounded,
	draw,
	MAX_BOUND,
	PHASE,
	type Phase,
	SUBJECT,
	type SubjectKind,
} from "../random/rng";
import { targetValue } from "./arbitration";
import { validTarget } from "./target";

const PHASE_NAME: Readonly<Record<Phase, string>> = {
	[PHASE.propose]: "propose",
	[PHASE.action]: "action",
	[PHASE.tick]: "tick",
	[PHASE.spawn]: "spawn",
	[PHASE.core]: "core",
};

// Frozen once built: only core moves it between floors and modules, through its setters.
export class Context implements ActionCtx {
	#module = 0;
	#floor = 0;
	readonly #engine: Engine;
	readonly #phase: Phase;
	readonly width: number;
	readonly height: number;

	constructor(
		engine: Engine,
		phase: Phase,
		readonly step: ActionRef<"cell">,
		readonly idle: ActionRef<"none">,
		readonly travel: ActionRef<"entity">,
	) {
		this.#engine = engine;
		this.#phase = phase;
		this.width = engine.grid.width;
		this.height = engine.grid.height;
		Object.freeze(this);
	}

	get floor(): number {
		return this.#floor;
	}

	setFloor(floor: number): void {
		this.#floor = floor;
	}

	setModule(module: number): void {
		this.#module = module;
	}

	inTickOf(module: number): boolean {
		return this.#phase === PHASE.tick && this.#module === module;
	}

	isAlive(id: EntityId): boolean {
		return this.#engine.storage.slotOf(this.#floor, id) !== NONE;
	}

	slotOf(id: EntityId): Slot {
		return this.#engine.storage.slotOf(this.#floor, id);
	}

	idOf(slot: Slot): EntityId {
		return (this.#engine.storage.ids[slot] ?? 0) as EntityId;
	}

	x(slot: Slot): number {
		return this.#engine.grid.x[slot] ?? 0;
	}

	y(slot: Slot): number {
		return this.#engine.grid.y[slot] ?? 0;
	}

	cellAt(x: number, y: number): Cell {
		return this.#engine.grid.cellAt(x, y);
	}

	// Off the floor holds nothing, as a step there fails rather than throws.
	holdsActor(cell: Cell): boolean {
		if (cell === NO_CELL) return false;
		const grid = this.#engine.grid;
		if (!(Number.isInteger(cell) && cell >= 0 && cell < grid.cells))
			throw new Error(`holdsActor: cell ${cell} is not on the floor`);
		return grid.holdsOtherActor(this.#floor, cell, NONE);
	}

	firstAt(cell: Cell): Slot {
		const grid = this.#engine.grid;
		if (cell >>> 0 >= grid.cells) {
			if (cell === NO_CELL) return NONE;
			throw new Error(`firstAt: cell ${cell} is not on the floor`);
		}
		return (grid.heads[this.#floor * grid.cells + cell] ?? NONE) as Slot;
	}

	nextAt(slot: Slot): Slot {
		return (this.#engine.grid.next[slot] ?? NONE) as Slot;
	}

	rng(subject: EntityId, n: number, bound: number): number {
		return this.#roll(SUBJECT.entity, subject, n, bound);
	}

	rngCell(cell: Cell, n: number, bound: number): number {
		const grid = this.#engine.grid;
		if (!(Number.isInteger(cell) && cell >= 0 && cell < grid.cells))
			throw new Error(`rngCell: cell ${cell} is not on the floor`);
		return this.#roll(SUBJECT.cell, this.#floor * grid.cells + cell, n, bound);
	}

	kill(id: EntityId, cause: EntityId): void {
		this.checkWritable("kill");
		this.#engine.kills.push(id, cause);
	}

	harm(target: EntityId, amount: number, cause: EntityId): void {
		this.checkWritable("harm");
		const i32 = (v: number) => (v | 0) === v;
		if (!(i32(target) && i32(cause) && i32(amount) && amount >= 1))
			throw new Error(
				`harm amount ${amount} must be an i32 >= 1, with i32 ids`,
			);
		this.#engine.harms.push(target, cause, amount);
	}

	spawn(species: SpeciesRef, x: number, y: number, cause: EntityId): void {
		this.checkWritable("spawn");
		const e = this.#engine;
		const cell = checkSpawn(e, this.#floor, x, y);
		e.spawns.push(species.index, x, y, cell, cause);
	}

	emit(event: EventRef, cause: EntityId, a: number, b: number): void {
		this.checkWritable("emit");
		if (!(Number.isInteger(a) && Number.isInteger(b)))
			throw new Error(`event payload (${a}, ${b}) must be integers`);
		this.#engine.emit(this.#floor, event, cause, a, b);
	}

	instead<K extends TargetKind>(
		action: ActionRef<K>,
		target: TargetOf[K],
	): typeof ALTERNATE {
		if (this.#phase !== PHASE.action)
			throw new Error(`instead is not allowed in ${PHASE_NAME[this.#phase]}`);
		const e = this.#engine;
		const value = targetValue(target);
		const entry = e.actions[action.index] as ActionEntry;
		if (!validTarget(entry.kind, value, e.grid.cells, e.storage.floors))
			throw new Error(`${entry.name} cannot target ${value}`);
		e.setAlternate(action.index, value);
		return ALTERNATE;
	}

	// Propose shares the action context's type, so its writes are refused at run time.
	checkWritable(what: string): void {
		if (this.#phase === PHASE.propose)
			throw new Error(`${what} is not allowed in propose`);
	}

	#roll(kind: SubjectKind, subject: number, n: number, bound: number): number {
		if (!(Number.isInteger(bound) && bound >= 1 && bound < MAX_BOUND))
			throw new Error(`rng bound ${bound} outside [1, ${MAX_BOUND})`);
		const e = this.#engine;
		const time = e.now[this.#floor] ?? 0;
		const h = draw(e.seed, this.#module, this.#phase, time, kind, subject, n);
		return bounded(h, bound);
	}
}

Object.freeze(Context.prototype);
