import { CAP } from "../config";
import { type EntityId, NONE } from "../ecs/ids";
import { ALIVE } from "../ecs/storage";
import { type ActionEntry, type Engine, KIND_CODE } from "../engine";
import type { EventVisitor } from "../events/events";
import { spawn } from "../lifecycle/lifecycle";
import type {
	ComponentName,
	FieldName,
	SpawnFields,
	Species,
} from "../lifecycle/species";
import type { AnyModule } from "../module/api";
import { engineDigest, hashHex } from "../persistence/hash";
import { saveFloor, WORD } from "../persistence/image";
import { saveWorld } from "../persistence/save";
import { loadFloor } from "../persistence/validate";
import { hashName } from "../random/rng";
import { advance, dueOn, playerTurn } from "../turns/round";
import { validTarget } from "../turns/target";
import type { InputRecord, LoadOptions, Location, World } from "./world";

// The World interface over one engine: the guards every call goes through.
export class GameWorld<M extends readonly AnyModule[], S extends string>
	implements World<M, S>
{
	// A round that threw left its floor half-applied: nothing may build on that state.
	private poisoned = false;
	private draining = false;
	private readonly log: InputRecord[] = [];
	// Floors whose due player has played since the last advance. A protocol rule only, so not
	// saved: the scheduler's order already rules out a double or out-of-order turn.
	private readonly played = new Set<number>();

	// An ES private field: a TS `private` would still leave the engine reachable at runtime.
	readonly #engine: Engine;

	constructor(engine: Engine) {
		this.#engine = engine;
	}

	spawn(
		floor: number,
		species: string | Species<M>,
		x: number,
		y: number,
		values?: SpawnFields<M>,
	): EntityId {
		this.checkMutable();
		return spawn(this.#engine, floor, species, x, y, false, values);
	}

	spawnPlayer(
		floor: number,
		species: string | Species<M>,
		x: number,
		y: number,
		values?: SpawnFields<M>,
	): EntityId {
		this.checkMutable();
		return spawn(this.#engine, floor, species, x, y, true, values);
	}

	runRounds(n: number): void {
		this.run(() => {
			for (let i = 0; i < n; i++) this.#engine.runRound();
		});
	}

	advance(): readonly EntityId[] {
		this.checkMutable();
		this.played.clear();
		return this.run(() => Object.freeze(advance(this.#engine)));
	}

	input(player: EntityId, action: string, target: number | null): void {
		this.checkMutable();
		const e = this.#engine;
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

	loadFloor(floor: number, bytes: Uint8Array, options?: LoadOptions): void {
		this.checkMutable();
		const image = bytes.byteOffset % WORD === 0 ? bytes : bytes.slice();
		loadFloor(this.#engine, image, this.checkFloor(floor), options?.check);
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
		return this.#engine.storage.floorOf(id) >= 0;
	}

	locate(id: EntityId): Location {
		this.checkHealthy();
		const { storage, grid, inbox } = this.#engine;
		const floor = storage.floorOf(id);
		if (floor >= 0) {
			const slot = storage.slotOf(floor, id);
			return { floor, x: grid.x[slot] ?? 0, y: grid.y[slot] ?? 0 };
		}
		return inbox.holds(id) ? "transit" : "dead";
	}

	peek<N extends ComponentName<M>>(
		component: N,
		field: FieldName<M, N>,
		id: EntityId,
	): number {
		this.checkHealthy();
		const { storage, components } = this.#engine;
		const floor = storage.floorOf(id);
		const slot = floor < 0 ? NONE : storage.slotOf(floor, id);
		const entry = components.get(component);
		if (slot === NONE || !entry) throw new Error(`no ${component} on ${id}`);
		const word = storage.masks[slot * storage.maskWords + entry.bit.word] ?? 0;
		if ((word & entry.bit.bit) === 0)
			throw new Error(`no ${component} on ${id}`);
		return entry.columns[field]?.[slot] ?? 0;
	}

	entities(
		floor: number,
		visit: (id: EntityId, species: S, x: number, y: number) => void,
	): void {
		this.checkHealthy();
		const { storage, grid, speciesIndex, speciesNames } = this.#engine;
		const { masks, maskWords, ids } = storage;
		const from = this.checkFloor(floor) * CAP;
		const end = from + (storage.highWater[floor] ?? 0);
		for (let s = from; s < end; s++) {
			if (((masks[s * maskWords] ?? 0) & ALIVE) === 0) continue;
			const id = (ids[s] ?? 0) as EntityId;
			const species = speciesNames[(speciesIndex[s] ?? 0) - 1];
			if (species === undefined)
				throw new Error(`entity ${id} has no species name`);
			// The names are the keys of the species table typed S.
			visit(id, species as S, grid.x[s] ?? 0, grid.y[s] ?? 0);
		}
	}

	hash(): string {
		this.checkHealthy();
		engineDigest(this.#engine);
		return hashHex(this.#engine.digest);
	}

	saveFloor(floor: number, into?: Uint8Array): Uint8Array {
		this.checkHealthy();
		return saveFloor(this.#engine, this.checkFloor(floor), into);
	}

	save(): Uint8Array {
		this.checkHealthy();
		return saveWorld(this.#engine);
	}

	// Each event is consumed before its visitor runs, so a throwing visitor never sees it twice.
	drainEvents(floor: number, visit: EventVisitor): void {
		this.checkMutable();
		this.draining = true;
		try {
			this.#engine.events.drain(this.checkFloor(floor), visit);
		} finally {
			this.draining = false;
		}
	}

	eventType(name: string): number {
		this.checkHealthy();
		const type = hashName(name) | 0;
		if (this.#engine.eventNames.get(type) !== name)
			throw new Error(`no event ${name}`);
		return type;
	}

	setEvents(floor: number, on: boolean): void {
		this.checkMutable();
		this.#engine.events.enabled[this.checkFloor(floor)] = on ? 1 : 0;
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
		// A getter in a spawn's species or values runs mid-spawn.
		if (this.#engine.spawning)
			throw new Error(
				"a spawn is reading its species and values: the world cannot change now",
			);
	}

	private checkFloor(floor: number): number {
		if (
			!(
				Number.isInteger(floor) &&
				floor >= 0 &&
				floor < this.#engine.storage.floors
			)
		)
			throw new Error(`no floor ${floor}`);
		return floor;
	}
}
