import type { AnyModule } from "./api";
import { MAX_COORD, MAX_FLOORS, MAX_SEED, TICKS_PER_TURN } from "./config";
import type { Engine } from "./engine";
import { hashEngine } from "./hash";
import { type EntityId, NONE } from "./ids";
import { createEngine, type WorldShape } from "./registration";
import type { ComponentName, FieldName, Species } from "./species";

export interface WorldOptions<M extends readonly AnyModule[]>
	extends WorldShape {
	readonly modules: M;
}

export interface World<M extends readonly AnyModule[]> {
	spawn(floor: number, species: Species<M>, x: number, y: number): EntityId;
	runRounds(n: number): void;
	alive(id: EntityId): boolean;
	peek<N extends ComponentName<M>>(
		component: N,
		field: FieldName<M, N>,
		id: EntityId,
	): number;
	hash(): string;
}

export function createWorld<const M extends readonly AnyModule[]>(
	options: WorldOptions<M>,
): World<M> {
	const { seed, floors, width, height } = options;
	if (!(Number.isInteger(seed) && seed >= 0 && seed <= MAX_SEED))
		throw new Error(`seed ${seed} is not a u32`);
	if (!(Number.isInteger(floors) && floors >= 1 && floors <= MAX_FLOORS))
		throw new Error(`floors ${floors} outside [1, ${MAX_FLOORS}]`);
	for (const side of [width, height])
		if (!(Number.isInteger(side) && side >= 1 && side <= MAX_COORD))
			throw new Error(`floor side ${side} outside [1, ${MAX_COORD}]`);
	return new GameWorld<M>(createEngine(options, options.modules));
}

class GameWorld<M extends readonly AnyModule[]> implements World<M> {
	constructor(private readonly engine: Engine) {}

	spawn(floor: number, species: Species<M>, x: number, y: number): EntityId {
		const at = this.engine.round * TICKS_PER_TURN;
		return this.engine.spawn(floor, species, x, y, at);
	}

	runRounds(n: number): void {
		for (let i = 0; i < n; i++) this.engine.runRound();
	}

	alive(id: EntityId): boolean {
		return this.engine.storage.floorOf(id) >= 0;
	}

	peek<N extends ComponentName<M>>(
		component: N,
		field: FieldName<M, N>,
		id: EntityId,
	): number {
		const { storage, components } = this.engine;
		const floor = storage.floorOf(id);
		const slot = floor < 0 ? NONE : storage.slotOf(floor, id);
		const entry = components.get(component);
		if (slot === NONE || !entry) throw new Error(`no ${component} on ${id}`);
		const word = storage.masks[slot * storage.maskWords + entry.bit.word] ?? 0;
		if ((word & entry.bit.bit) === 0)
			throw new Error(`no ${component} on ${id}`);
		return entry.columns[field]?.[slot] ?? 0;
	}

	hash(): string {
		return hashEngine(this.engine);
	}
}
