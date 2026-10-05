import type { AnyModule } from "./api";
import { CAP, MAX_COORD, MAX_FLOORS, MAX_SEED, TICKS_PER_TURN } from "./config";
import type { Engine } from "./engine";
import type { EventVisitor } from "./events";
import { engineDigest, hashHex, worldDigest } from "./hash";
import { type EntityId, NONE } from "./ids";
import { FLOOR_HEADER, readFloor, SUM, saveFloor } from "./image";
import { spawn } from "./lifecycle";
import { createEngine } from "./registration";
import { hashName } from "./rng";
import { readWorld, saveWorld } from "./save";
import type { ComponentName, FieldName, Species } from "./species";
import { INDEX_SIZE } from "./storage";
import { checkFloor } from "./validate";

export interface WorldOptions<M extends readonly AnyModule[]> {
	readonly seed: number;
	readonly floors: number;
	readonly width: number;
	readonly height: number;
	readonly popCap?: number;
	readonly events?: boolean;
	readonly modules: M;
	readonly species?: Readonly<Record<string, Species<M>>>;
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
	saveFloor(floor: number): Uint8Array;
	save(): Uint8Array;
	// The visitor runs once per event, oldest first; the floor's events are gone afterwards.
	drainEvents(floor: number, visit: EventVisitor): void;
	eventType(name: string): number;
	setEvents(floor: number, on: boolean): void;
}

function build(options: WorldOptions<readonly AnyModule[]>): Engine {
	const { seed, floors, width, height } = options;
	const popCap = options.popCap ?? CAP;
	if (!(Number.isInteger(seed) && seed >= 0 && seed <= MAX_SEED))
		throw new Error(`seed ${seed} is not a u32`);
	if (!(Number.isInteger(floors) && floors >= 1 && floors <= MAX_FLOORS))
		throw new Error(`floors ${floors} outside [1, ${MAX_FLOORS}]`);
	for (const side of [width, height])
		if (!(Number.isInteger(side) && side >= 1 && side <= MAX_COORD))
			throw new Error(`floor side ${side} outside [1, ${MAX_COORD}]`);
	if (!(Number.isInteger(popCap) && popCap >= 1 && popCap <= CAP))
		throw new Error(`popCap ${popCap} outside [1, ${CAP}]`);
	return createEngine(
		{ seed, floors, width, height, popCap, events: options.events ?? true },
		options.modules,
		options.species,
	);
}

export function createWorld<const M extends readonly AnyModule[]>(
	options: WorldOptions<M>,
): World<M> {
	return new GameWorld<M>(build(options));
}

export function loadWorld<const M extends readonly AnyModule[]>(
	bytes: Uint8Array,
	options: {
		readonly modules: M;
		readonly species?: Readonly<Record<string, Species<M>>>;
	},
): World<M> {
	const { header, hash, images } = readWorld(bytes);
	const { round, events, ...shape } = header;
	const engine = build({ ...shape, ...options });
	const indexes = images.map(() => new Int32Array(INDEX_SIZE));
	const sums = new Int32Array(2 * images.length);
	images.forEach((image, f) => {
		checkFloor(engine, image, f, round, indexes[f] as Int32Array);
		const words = new Int32Array(image.buffer, image.byteOffset, FLOOR_HEADER);
		sums[2 * f] = words[SUM] ?? 0;
		sums[2 * f + 1] = words[SUM + 1] ?? 0;
	});
	worldDigest(engine.sum, header, events, sums, engine.digest);
	if (engine.digest[0] !== hash[0] || engine.digest[1] !== hash[1])
		throw new Error("save file: contents do not match its hash");
	images.forEach((image, f) => {
		readFloor(engine, image, indexes[f] as Int32Array);
	});
	engine.round = round;
	engine.events.enabled.set(events);
	return new GameWorld<M>(engine);
}

class GameWorld<M extends readonly AnyModule[]> implements World<M> {
	// A round that threw left its floor half-applied: nothing may build on that state.
	private poisoned = false;
	private draining = false;

	constructor(private readonly engine: Engine) {}

	spawn(floor: number, species: Species<M>, x: number, y: number): EntityId {
		this.checkMutable();
		const at = this.engine.round * TICKS_PER_TURN;
		return spawn(this.engine, floor, species, x, y, at);
	}

	runRounds(n: number): void {
		this.checkMutable();
		try {
			for (let i = 0; i < n; i++) this.engine.runRound();
		} catch (error) {
			this.poisoned = true;
			throw error;
		}
	}

	alive(id: EntityId): boolean {
		this.checkHealthy();
		return this.engine.storage.floorOf(id) >= 0;
	}

	peek<N extends ComponentName<M>>(
		component: N,
		field: FieldName<M, N>,
		id: EntityId,
	): number {
		this.checkHealthy();
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
		this.checkHealthy();
		engineDigest(this.engine);
		return hashHex(this.engine.digest);
	}

	saveFloor(floor: number): Uint8Array {
		this.checkHealthy();
		return saveFloor(this.engine, this.checkFloor(floor));
	}

	save(): Uint8Array {
		this.checkHealthy();
		return saveWorld(this.engine);
	}

	// Each event is consumed before its visitor runs, so a throwing visitor never sees it twice.
	drainEvents(floor: number, visit: EventVisitor): void {
		this.checkMutable();
		this.draining = true;
		try {
			this.engine.events.drain(this.checkFloor(floor), visit);
		} finally {
			this.draining = false;
		}
	}

	eventType(name: string): number {
		this.checkHealthy();
		const type = hashName(name) | 0;
		if (this.engine.eventNames.get(type) !== name)
			throw new Error(`no event ${name}`);
		return type;
	}

	setEvents(floor: number, on: boolean): void {
		this.checkMutable();
		this.engine.events.enabled[this.checkFloor(floor)] = on ? 1 : 0;
	}

	private checkHealthy(): void {
		if (this.poisoned)
			throw new Error("world is poisoned: an earlier round threw");
	}

	// A visitor runs mid-drain: changing the world then would interleave new events with the drained ones.
	private checkMutable(): void {
		this.checkHealthy();
		if (this.draining)
			throw new Error("world is draining events: it cannot change now");
	}

	private checkFloor(floor: number): number {
		if (
			!(
				Number.isInteger(floor) &&
				floor >= 0 &&
				floor < this.engine.storage.floors
			)
		)
			throw new Error(`no floor ${floor}`);
		return floor;
	}
}
