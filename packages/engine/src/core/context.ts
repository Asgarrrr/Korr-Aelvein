import {
	type ActionCtx,
	type ActionRef,
	ALTERNATE,
	type EventRef,
	type SpeciesRef,
	type TargetKind,
	type TargetOf,
} from "./api";
import { targetValue } from "./candidates";
import type { Engine } from "./engine";
import { type Cell, type EntityId, NONE, type Slot } from "./ids";
import { checkSpawn } from "./lifecycle";
import {
	bounded,
	draw,
	MAX_BOUND,
	type Phase,
	SUBJECT,
	type SubjectKind,
} from "./rng";

export class Context implements ActionCtx {
	module = 0;
	floor = 0;

	constructor(
		private readonly engine: Engine,
		private readonly phase: Phase,
		readonly step: ActionRef<"cell">,
		readonly idle: ActionRef<"none">,
	) {}

	isAlive(id: EntityId): boolean {
		return this.engine.storage.slotOf(this.floor, id) !== NONE;
	}

	slotOf(id: EntityId): Slot {
		return this.engine.storage.slotOf(this.floor, id);
	}

	idOf(slot: Slot): EntityId {
		return (this.engine.storage.ids[slot] ?? 0) as EntityId;
	}

	x(slot: Slot): number {
		return this.engine.grid.x[slot] ?? 0;
	}

	y(slot: Slot): number {
		return this.engine.grid.y[slot] ?? 0;
	}

	cellAt(x: number, y: number): Cell {
		return this.engine.grid.cellAt(x, y);
	}

	rng(subject: EntityId, n: number, bound: number): number {
		return this.roll(SUBJECT.entity, subject, n, bound);
	}

	rngCell(cell: Cell, n: number, bound: number): number {
		const grid = this.engine.grid;
		if (!(Number.isInteger(cell) && cell >= 0 && cell < grid.cells))
			throw new Error(`rngCell: cell ${cell} is not on the floor`);
		return this.roll(SUBJECT.cell, this.floor * grid.cells + cell, n, bound);
	}

	kill(id: EntityId, cause: EntityId): void {
		this.engine.kills.push(id, cause);
	}

	spawn(species: SpeciesRef, x: number, y: number, cause: EntityId): void {
		const e = this.engine;
		const cell = checkSpawn(e, this.floor, x, y);
		e.spawns.push(species.index, x, y, cell, cause);
	}

	emit(event: EventRef, cause: EntityId, a: number, b: number): void {
		if (!(Number.isInteger(a) && Number.isInteger(b)))
			throw new Error(`event payload (${a}, ${b}) must be integers`);
		this.engine.emit(this.floor, event, cause, a, b);
	}

	instead<K extends TargetKind>(
		action: ActionRef<K>,
		target: TargetOf[K],
	): typeof ALTERNATE {
		this.engine.setAlternate(action.index, targetValue(target));
		return ALTERNATE;
	}

	private roll(
		kind: SubjectKind,
		subject: number,
		n: number,
		bound: number,
	): number {
		if (!(Number.isInteger(bound) && bound >= 1 && bound < MAX_BOUND))
			throw new Error(`rng bound ${bound} outside [1, ${MAX_BOUND})`);
		const e = this.engine;
		const time = e.now[this.floor] ?? 0;
		const h = draw(e.seed, this.module, this.phase, time, kind, subject, n);
		return bounded(h, bound);
	}
}
