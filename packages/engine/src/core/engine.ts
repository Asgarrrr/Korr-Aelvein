import type {
	ActionFn,
	ActionRef,
	EventRef,
	ProposeFn,
	TargetKind,
	TickFn,
} from "./api";
import { CandidateBuffer } from "./candidates";
import { Checksum } from "./checksum";
import { CAP, TICKS_PER_TURN } from "./config";
import { Context } from "./context";
import { DeferredKills, DeferredSpawns } from "./deferred";
import { EventLog } from "./events";
import { Grid } from "./grid";
import type { WorldFields } from "./hash";
import type { EntityId } from "./ids";
import type { Section } from "./image";
import { PerceptionBuffer } from "./perception";
import { hashName, PHASE } from "./rng";
import { Scheduler } from "./scheduler";
import type { Column } from "./schema";
import type { CompiledSpecies } from "./species";
import { INDEX_SIZE, type MaskBit, Storage } from "./storage";
import { runFloor, step as stepTo } from "./turn";

export const KIND_CODE: Readonly<Record<TargetKind, number>> = {
	none: 0,
	entity: 1,
	cell: 2,
};

export interface Component {
	readonly bit: MaskBit;
	readonly columns: Readonly<Record<string, Column>>;
}

export interface ActionEntry {
	readonly key: number;
	readonly kind: number;
	readonly moduleKey: number;
	readonly run: ActionFn<TargetKind>;
}

export interface Hook<F> {
	readonly moduleKey: number;
	readonly run: F;
}

export interface EngineOptions {
	readonly seed: number;
	readonly floors: number;
	readonly width: number;
	readonly height: number;
	readonly componentCount: number;
	readonly popCap: number;
	readonly events: boolean;
}

export const CORE = "core";
export const CORE_KEY = hashName(CORE);
export const NO_ACTION = -1;

export class Engine {
	readonly seed: number;
	readonly storage: Storage;
	readonly grid: Grid;
	readonly scheduler: Scheduler;
	readonly now: Int32Array;
	readonly popCap: number;
	readonly events: EventLog;
	round = 0;
	fingerprint = 0;
	sections: readonly Section[] = [];

	// Reused buffers: hashing and saving allocate nothing per call, loading little.
	readonly sum = new Checksum();
	readonly floorSums: Int32Array;
	readonly digest = new Int32Array(2);
	readonly shape: { -readonly [K in keyof WorldFields]: WorldFields[K] };
	readonly checkFreed = new Uint8Array(CAP);
	readonly checkListed = new Uint8Array(CAP);
	readonly checkIndex = new Int32Array(INDEX_SIZE);

	readonly components = new Map<string, Component>();
	readonly actions: ActionEntry[] = [];
	readonly ticks: Hook<TickFn>[] = [];
	readonly proposers: Hook<ProposeFn>[] = [];
	readonly eventNames = new Map<number, string>();
	readonly species: CompiledSpecies[] = [];

	readonly kills = new DeferredKills();
	readonly spawns = new DeferredSpawns();
	readonly perception: PerceptionBuffer;
	readonly candidates: CandidateBuffer;
	readonly tickCtx: Context;
	readonly proposeCtx: Context;
	readonly actionCtx: Context;
	readonly idleIndex: number;
	readonly died: EventRef;
	readonly spawned: EventRef;
	alternate = NO_ACTION;
	alternateTarget = 0;

	constructor(options: EngineOptions) {
		this.seed = options.seed;
		this.storage = new Storage(options.floors, options.componentCount);
		this.grid = new Grid(this.storage, options.width, options.height);
		this.scheduler = new Scheduler(this.storage);
		this.now = new Int32Array(options.floors);
		this.popCap = options.popCap;
		this.floorSums = new Int32Array(2 * options.floors);
		this.shape = {
			seed: options.seed,
			round: 0,
			floors: options.floors,
			width: options.width,
			height: options.height,
			popCap: options.popCap,
		};
		this.events = new EventLog(options.floors, options.events);
		this.died = this.addEvent(`${CORE}/died`);
		this.spawned = this.addEvent(`${CORE}/spawned`);
		this.perception = new PerceptionBuffer(this.grid, this.storage.ids);
		this.candidates = new CandidateBuffer(this.actions);

		const step = this.addAction(
			CORE_KEY,
			hashName(`${CORE}/step`),
			"cell",
			(_ctx, actor, cell): number => stepTo(this, actor, cell),
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

	// Keyed by name hash, not registry position: adding a module never renumbers other events.
	addEvent(name: string): EventRef {
		const key = hashName(name) | 0;
		const taken = this.eventNames.get(key);
		if (taken === name) throw new Error(`duplicate event ${name}`);
		if (taken) throw new Error(`event key collision: ${name} and ${taken}`);
		this.eventNames.set(key, name);
		return { key } as EventRef;
	}

	emit(
		floor: number,
		event: EventRef,
		cause: EntityId,
		a: number,
		b: number,
	): void {
		const time = this.now[floor] ?? 0;
		this.events.emit(floor, event.key, cause, a, b, time);
	}

	setAlternate(action: number, target: number): void {
		this.alternate = action;
		this.alternateTarget = target;
	}

	runRound(): void {
		for (let f = 0; f < this.storage.floors; f++) runFloor(this, f);
		this.round++;
	}
}
