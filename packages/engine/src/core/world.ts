import type { AnyModule } from "./api";
import { CAP, MAX_COORD, MAX_FLOORS, MAX_SEED } from "./config";
import { type EntityId, NONE } from "./ecs/ids";
import { INDEX_SIZE } from "./ecs/storage";
import {
	type ActionEntry,
	type Engine,
	FLOOR_STAGE,
	KIND_CODE,
} from "./engine";
import type { EventVisitor } from "./events/events";
import { spawn } from "./lifecycle/lifecycle";
import type { ComponentName, FieldName, Species } from "./lifecycle/species";
import { engineDigest, hashHex, worldDigest } from "./persistence/hash";
import { identityProblem } from "./persistence/identity";
import {
	FLOOR_HEADER,
	readFloor,
	STAGE,
	SUM,
	saveFloor,
	WORD,
} from "./persistence/image";
import { readWorld, saveWorld } from "./persistence/save";
import { checkFloor, loadFloor } from "./persistence/validate";
import { hashName } from "./random/rng";
import { createEngine } from "./setup/registration";
import { ID } from "./travel/inbox";
import { advance, dueOn, playerTurn } from "./turns/round";
import { validTarget } from "./turns/target";

export interface WorldOptions<M extends readonly AnyModule[]> {
	readonly seed: number;
	readonly floors: number;
	readonly width: number;
	readonly height: number;
	readonly popCap?: number;
	readonly events?: boolean;
	readonly audit?: boolean;
	readonly modules: M;
	readonly species?: Readonly<Record<string, Species<M>>>;
	// A permutation of the floors, the order they run in within a round. Tests only: no
	// order may change the result.
	readonly floorOrder?: readonly number[];
}

export type Location =
	| { readonly floor: number; readonly x: number; readonly y: number }
	| "transit"
	| "dead";

export interface InputRecord {
	readonly round: number;
	readonly time: number;
	readonly player: EntityId;
	// As played: replaying a record is world.input(player, action, target).
	readonly action: string;
	readonly target: number | null;
}

export interface World<M extends readonly AnyModule[]> {
	spawn(floor: number, species: Species<M>, x: number, y: number): EntityId;
	spawnPlayer(
		floor: number,
		species: Species<M>,
		x: number,
		y: number,
	): EntityId;
	// Throws when a player becomes due: a world with players moves through advance and input.
	runRounds(n: number): void;
	// Runs every floor until its round ends or a player on it is due, and returns the due
	// players. Empty means the round ended everywhere; the next call starts the next round.
	advance(): readonly EntityId[];
	// One decision for a due player, by registered action name ("core/step"). An unknown name
	// or a target the action cannot take is recorded and played as core/idle.
	input(player: EntityId, action: string, target: number | null): void;
	inputs(): readonly InputRecord[];
	alive(id: EntityId): boolean;
	// "dead" also covers an id never issued.
	locate(id: EntityId): Location;
	peek<N extends ComponentName<M>>(
		component: N,
		field: FieldName<M, N>,
		id: EntityId,
	): number;
	hash(): string;
	saveFloor(floor: number): Uint8Array;
	// Replaces one floor with an image saved at this same point of this world's run.
	loadFloor(floor: number, bytes: Uint8Array): void;
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
	const order = options.floorOrder;
	if (
		order !== undefined &&
		!(
			order.length === floors &&
			[...order].sort((a, b) => a - b).every((f, i) => f === i)
		)
	)
		throw new Error(`floor order ${order} is not a permutation of the floors`);
	const engine = createEngine(
		{
			seed,
			floors,
			width,
			height,
			popCap,
			events: options.events ?? true,
			audit: options.audit ?? false,
		},
		options.modules,
		options.species,
	);
	if (order !== undefined) engine.floorOrder = [...order];
	return engine;
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
	const players = new Int32Array(images.length);
	images.forEach((image, f) => {
		players[f] = checkFloor(engine, image, f, round, indexes[f] as Int32Array);
		const words = new Int32Array(image.buffer, image.byteOffset, FLOOR_HEADER);
		sums[2 * f] = words[SUM] ?? 0;
		sums[2 * f + 1] = words[SUM + 1] ?? 0;
	});
	worldDigest(engine.sum, header, events, sums, engine.digest);
	if (engine.digest[0] !== hash[0] || engine.digest[1] !== hash[1])
		throw new Error("save file: contents do not match its hash");
	const started = images.map(
		(image) =>
			new Int32Array(image.buffer, image.byteOffset, FLOOR_HEADER)[STAGE] !==
			FLOOR_STAGE.waiting,
	);
	if (started.some((s) => s !== started[0]))
		throw new Error(
			"save file: some floors started the round and some did not",
		);
	images.forEach((image, f) => {
		readFloor(engine, image, indexes[f] as Int32Array, players[f] ?? 0);
	});
	const problem = identityProblem(engine);
	if (problem !== undefined) throw new Error(`save file: ${problem}`);
	engine.round = round;
	engine.events.enabled.set(events);
	return new GameWorld<M>(engine);
}

class GameWorld<M extends readonly AnyModule[]> implements World<M> {
	// A round that threw left its floor half-applied: nothing may build on that state.
	private poisoned = false;
	private draining = false;
	private readonly log: InputRecord[] = [];
	// Floors whose due player has played since the last advance. A protocol rule only, so not
	// saved: the scheduler's order already rules out a double or out-of-order turn.
	private readonly played = new Set<number>();

	constructor(private readonly engine: Engine) {}

	spawn(floor: number, species: Species<M>, x: number, y: number): EntityId {
		this.checkMutable();
		return spawn(this.engine, floor, species, x, y, this.now(floor));
	}

	spawnPlayer(
		floor: number,
		species: Species<M>,
		x: number,
		y: number,
	): EntityId {
		this.checkMutable();
		return spawn(this.engine, floor, species, x, y, this.now(floor), true);
	}

	runRounds(n: number): void {
		this.run(() => {
			for (let i = 0; i < n; i++) this.engine.runRound();
		});
	}

	advance(): readonly EntityId[] {
		this.checkMutable();
		this.played.clear();
		return this.run(() => Object.freeze(advance(this.engine)));
	}

	input(player: EntityId, action: string, target: number | null): void {
		this.checkMutable();
		const e = this.engine;
		const floor = e.storage.floorOf(player);
		const slot = floor < 0 ? NONE : e.storage.slotOf(floor, player);
		if (slot === NONE || this.played.has(floor) || dueOn(e, floor) !== slot)
			throw new Error(`player ${player} is not due`);
		let index = e.actionByName.get(action) ?? e.idleIndex;
		const { kind } = e.actions[index] as ActionEntry;
		const value = target ?? 0;
		const valid =
			kind === KIND_CODE.none
				? target === null
				: target !== null &&
					Number.isInteger(value) &&
					validTarget(kind, value, e.grid.cells, e.storage.floors);
		if (!valid) index = e.idleIndex;
		const entry = e.actions[index] as ActionEntry;
		this.log.push(
			Object.freeze({
				round: e.round,
				time: e.scheduler.nextAt[slot] ?? 0,
				player,
				action: entry.name,
				target: valid ? target : null,
			}),
		);
		this.played.add(floor);
		this.run(() => playerTurn(e, floor, slot, index, valid ? value : 0));
	}

	inputs(): readonly InputRecord[] {
		this.checkHealthy();
		return [...this.log];
	}

	loadFloor(floor: number, bytes: Uint8Array): void {
		this.checkMutable();
		const image = bytes.byteOffset % WORD === 0 ? bytes : bytes.slice();
		loadFloor(this.engine, image, this.checkFloor(floor));
	}

	// A floor's own clock: mid-round, a newcomer acts no earlier than the floor has reached.
	private now(floor: number): number {
		return this.engine.now[this.checkFloor(floor)] ?? 0;
	}

	private run<T>(body: () => T): T {
		this.checkMutable();
		try {
			return body();
		} catch (error) {
			this.poisoned = true;
			throw error;
		}
	}

	alive(id: EntityId): boolean {
		this.checkHealthy();
		return this.engine.storage.floorOf(id) >= 0;
	}

	locate(id: EntityId): Location {
		this.checkHealthy();
		const { storage, grid, inbox } = this.engine;
		const floor = storage.floorOf(id);
		if (floor >= 0) {
			const slot = storage.slotOf(floor, id);
			return { floor, x: grid.x[slot] ?? 0, y: grid.y[slot] ?? 0 };
		}
		for (let f = 0; f < storage.floors; f++) {
			const list = inbox.words(f);
			for (let i = 0; i < inbox.count(f); i++)
				if (list[i * inbox.width + ID] === id) return "transit";
		}
		return "dead";
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
