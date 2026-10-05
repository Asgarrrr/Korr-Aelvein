import type {
	ActionFn,
	ActionRef,
	EventRef,
	ProposeFn,
	TargetKind,
	TickFn,
} from "./api";
import type { Audit } from "./audit/audit";
import { CAP, TICKS_PER_TURN } from "./config";
import type { EntityId } from "./ecs/ids";
import type { Column } from "./ecs/schema";
import { INDEX_SIZE, type MaskBit, Storage } from "./ecs/storage";
import { EventLog } from "./events/events";
import { Harms } from "./health/harm";
import { coreSchema } from "./health/vitality";
import { DeferredKills, DeferredSpawns } from "./lifecycle/deferred";
import type { CompiledSpecies } from "./lifecycle/species";
import { Checksum } from "./persistence/checksum";
import type { WorldFields } from "./persistence/hash";
import type { Section } from "./persistence/image";
import { hashName, PHASE } from "./random/rng";
import { Grid } from "./space/grid";
import { PerceptionBuffer } from "./space/perception";
import { Inbox } from "./travel/inbox";
import { travel } from "./travel/travel";
import { CandidateBuffer } from "./turns/arbitration";
import { Context } from "./turns/context";
import { advance } from "./turns/round";
import { Scheduler } from "./turns/scheduler";
import { KIND_CODE } from "./turns/target";
import { step as stepTo } from "./turns/turn";

export { KIND_CODE } from "./turns/target";

export interface Component {
	readonly bit: MaskBit;
	readonly columns: Readonly<Record<string, Column>>;
}

export interface ActionEntry {
	readonly name: string;
	readonly key: number;
	readonly kind: number;
	readonly moduleKey: number;
	readonly run: ActionFn<TargetKind>;
}

export interface Hook<F> {
	readonly moduleKey: number;
	readonly run: F;
}

export interface Buffer {
	readonly current: Column;
	readonly previous: Column;
}

export interface TickHook extends Hook<TickFn> {
	readonly buffers: readonly Buffer[];
}

export interface Vitality {
	readonly hp: Int16Array;
	readonly max: Int16Array;
	readonly word: number;
	readonly bit: number;
}

export interface Link {
	readonly floor: Uint8Array;
	readonly x: Int16Array;
	readonly y: Int16Array;
	readonly word: number;
	readonly bit: number;
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
export const NO_FLOOR = -1;
export const FLOOR_STAGE = { waiting: 0, acting: 1, done: 2 } as const;

export class Engine {
	readonly seed: number;
	readonly storage: Storage;
	readonly grid: Grid;
	readonly scheduler: Scheduler;
	readonly now: Int32Array;
	readonly intentKey: Int32Array;
	readonly intentTarget: Int32Array;
	readonly popCap: number;
	readonly events: EventLog;
	round = 0;
	fingerprint = 0;
	sections: readonly Section[] = [];
	// Saved columns an entity takes along when it changes floor: all but identity, position, schedule and intent.
	carried: readonly Column[] = [];
	readonly stage: Uint8Array;
	// The decision period of each floor, fixed when its round starts.
	readonly period: Int32Array;
	// Derived from the rows like the scheduler, and rebuilt on load.
	readonly players: Int32Array;
	readonly inbox: Inbox;
	// A running hash of every departure from the floor and post into its inbox: an image restores
	// only while it matches.
	readonly traffic: Int32Array;
	// Order the floors run in within a round: results must not depend on it.
	floorOrder: readonly number[];

	// Reused buffers: hashing and saving allocate nothing per call, loading little.
	readonly sum = new Checksum();
	readonly floorSums: Int32Array;
	readonly digest = new Int32Array(2);
	readonly shape: { -readonly [K in keyof WorldFields]: WorldFields[K] };
	readonly checkFreed = new Uint8Array(CAP);
	readonly checkListed = new Uint8Array(CAP);
	readonly checkIndex = new Int32Array(INDEX_SIZE);

	readonly components = new Map<string, Component>();
	readonly cellColumns = new Map<string, Readonly<Record<string, Column>>>();
	readonly actions: ActionEntry[] = [];
	readonly actionByKey = new Map<number, number>();
	readonly actionByName = new Map<string, number>();
	readonly ticks: TickHook[] = [];
	readonly proposers: Hook<ProposeFn>[] = [];
	readonly eventNames = new Map<number, string>();
	readonly species: CompiledSpecies[] = [];

	readonly vitality: Vitality;
	readonly link: Link;
	readonly harms = new Harms();
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
	readonly departed: EventRef;
	readonly arrived: EventRef;
	alternate = NO_ACTION;
	leaveFloor = NO_FLOOR;
	leaveX = 0;
	leaveY = 0;
	alternateTarget = 0;
	failed = false;
	audit: Audit | undefined;

	constructor(options: EngineOptions) {
		this.seed = options.seed;
		this.storage = new Storage(options.floors, options.componentCount);
		this.grid = new Grid(this.storage, options.width, options.height);
		this.scheduler = new Scheduler(this.storage);
		this.intentKey = this.storage.column("i32") as Int32Array;
		this.intentTarget = this.storage.column("i32") as Int32Array;
		for (const [name, fields] of Object.entries(coreSchema)) {
			const columns: Record<string, Column> = {};
			for (const [field, kind] of Object.entries(fields))
				columns[field] = this.storage.column(kind);
			this.components.set(name, {
				bit: this.storage.componentBit(this.components.size),
				columns: Object.freeze(columns),
			});
		}
		const core = (name: keyof typeof coreSchema) =>
			this.components.get(name) as Component;
		const vitality = core("vitality");
		this.vitality = {
			hp: vitality.columns.hp as Int16Array,
			max: vitality.columns.max as Int16Array,
			...vitality.bit,
		};
		const link = core("link");
		this.link = {
			floor: link.columns.floor as Uint8Array,
			x: link.columns.x as Int16Array,
			y: link.columns.y as Int16Array,
			...link.bit,
		};
		this.now = new Int32Array(options.floors);
		this.stage = new Uint8Array(options.floors);
		this.period = new Int32Array(options.floors);
		this.players = new Int32Array(options.floors);
		this.inbox = new Inbox(options.floors);
		this.traffic = new Int32Array(options.floors);
		this.floorOrder = Array.from({ length: options.floors }, (_, f) => f);
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
		this.departed = this.addEvent(`${CORE}/departed`);
		this.arrived = this.addEvent(`${CORE}/arrived`);
		this.perception = new PerceptionBuffer(this.grid, this.storage.ids);
		this.candidates = new CandidateBuffer(
			this.actions,
			this.grid.cells,
			options.floors,
		);

		const step = this.addAction(
			CORE_KEY,
			`${CORE}/step`,
			"cell",
			(_ctx, actor, cell): number => stepTo(this, actor, cell),
		);
		const idle = this.addAction(
			CORE_KEY,
			`${CORE}/idle`,
			"none",
			() => TICKS_PER_TURN,
		);
		const leave = this.addAction(
			CORE_KEY,
			`${CORE}/travel`,
			"entity",
			(_ctx, actor, stairs): number => travel(this, actor, stairs),
		);
		this.idleIndex = idle.index;
		this.tickCtx = new Context(this, PHASE.tick, step, idle, leave);
		this.proposeCtx = new Context(this, PHASE.propose, step, idle, leave);
		this.actionCtx = new Context(this, PHASE.action, step, idle, leave);
	}

	addAction<K extends TargetKind>(
		moduleKey: number,
		name: string,
		kind: K,
		run: ActionFn<K>,
	): ActionRef<K> {
		const key = hashName(name);
		if (this.actions.some((a) => a.key === key))
			throw new Error(`duplicate action key ${key}`);
		const index = this.actions.length;
		this.actionByKey.set(key | 0, index);
		this.actionByName.set(name, index);
		this.actions.push({
			name,
			key,
			kind: KIND_CODE[kind],
			moduleKey,
			run: run as ActionFn<TargetKind>,
		});
		return Object.freeze({ index }) as ActionRef<K>;
	}

	// Keyed by name hash, not registry position: adding a module never renumbers other events.
	addEvent(name: string): EventRef {
		const key = hashName(name) | 0;
		const taken = this.eventNames.get(key);
		if (taken === name) throw new Error(`duplicate event ${name}`);
		if (taken) throw new Error(`event key collision: ${name} and ${taken}`);
		this.eventNames.set(key, name);
		return Object.freeze({ key }) as EventRef;
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

	// One whole round; for worlds and tests without players.
	runRound(): void {
		const due = advance(this);
		if (due.length > 0)
			throw new Error(
				`player ${due[0]} is due: a world with players runs through advance and input`,
			);
	}

	setAlternate(action: number, target: number): void {
		this.alternate = action;
		this.alternateTarget = target;
	}
}
