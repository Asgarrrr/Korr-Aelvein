import type { AnyModule } from "./api";
import { type EntityId, NONE } from "./ecs/ids";
import { type ActionEntry, type Engine, KIND_CODE } from "./engine";
import type { EventVisitor } from "./events/events";
import { spawn } from "./lifecycle/lifecycle";
import type { ComponentName, FieldName, Species } from "./lifecycle/species";
import { engineDigest, hashHex } from "./persistence/hash";
import { saveFloor, WORD } from "./persistence/image";
import { saveWorld } from "./persistence/save";
import { loadFloor } from "./persistence/validate";
import { hashName } from "./random/rng";
import { ID } from "./travel/inbox";
import { advance, dueOn, playerTurn } from "./turns/round";
import { validTarget } from "./turns/target";
import type { InputRecord, LoadOptions, Location, World } from "./world";

// The World interface over one engine: the guards every call goes through.
export class GameWorld<M extends readonly AnyModule[]> implements World<M> {
	// A round that threw left its floor half-applied: nothing may build on that state.
	private poisoned = false;
	private draining = false;
	private readonly log: InputRecord[] = [];
	// Floors whose due player has played since the last advance. A protocol rule only, so not
	// saved: the scheduler's order already rules out a double or out-of-order turn.
	private readonly played = new Set<number>();

	constructor(private readonly engine: Engine) {}

	spawn(
		floor: number,
		species: string | Species<M>,
		x: number,
		y: number,
		values?: Species<M>["components"],
	): EntityId {
		this.checkMutable();
		return spawn(this.engine, floor, species, x, y, false, values);
	}

	spawnPlayer(
		floor: number,
		species: string | Species<M>,
		x: number,
		y: number,
		values?: Species<M>["components"],
	): EntityId {
		this.checkMutable();
		return spawn(this.engine, floor, species, x, y, true, values);
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

	loadFloor(floor: number, bytes: Uint8Array, options?: LoadOptions): void {
		this.checkMutable();
		const image = bytes.byteOffset % WORD === 0 ? bytes : bytes.slice();
		loadFloor(this.engine, image, this.checkFloor(floor), options?.check);
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

	saveFloor(floor: number, into?: Uint8Array): Uint8Array {
		this.checkHealthy();
		return saveFloor(this.engine, this.checkFloor(floor), into);
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
		// A getter in a spawn's species or values runs mid-spawn.
		if (this.engine.spawning)
			throw new Error(
				"a spawn is reading its species and values: the world cannot change now",
			);
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
