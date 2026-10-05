import type { Contracts } from "../contracts";
import type { Cell, EntityId, Slot } from "./ecs/ids";
import type { Query } from "./ecs/query";
import type {
	Columns,
	FieldKind,
	Fields,
	FieldValue,
	Schema,
} from "./ecs/schema";
import type { SpeciesShape } from "./lifecycle/species";

export { PERCEPTION_RADIUS } from "./config";
export type { Cell, EntityId, Slot } from "./ecs/ids";
export { NO_CELL, NONE } from "./ecs/ids";
export type { Query, SlotList } from "./ecs/query";
export type { Schema } from "./ecs/schema";
export type { SpeciesShape } from "./lifecycle/species";

export interface TargetOf {
	entity: EntityId;
	cell: Cell;
	none: null;
}
export type TargetKind = keyof TargetOf;

declare const actionBrand: unique symbol;
export interface ActionRef<K extends TargetKind> {
	readonly [actionBrand]: K;
	readonly index: number;
}

declare const eventBrand: unique symbol;
export interface EventRef {
	readonly [eventBrand]: true;
	readonly key: number;
}

declare const speciesBrand: unique symbol;
export interface SpeciesRef {
	readonly [speciesBrand]: true;
	readonly index: number;
}

declare const sentinelBrand: unique symbol;
export type Sentinel = number & { readonly [sentinelBrand]: true };
export const FAIL = -1 as Sentinel;
export const ALTERNATE = -2 as Sentinel;

export interface ReadCtx {
	readonly step: ActionRef<"cell">;
	readonly idle: ActionRef<"none">;
	isAlive(id: EntityId): boolean;
	slotOf(id: EntityId): Slot;
	idOf(slot: Slot): EntityId;
	x(slot: Slot): number;
	y(slot: Slot): number;
	cellAt(x: number, y: number): Cell;
	holdsActor(cell: Cell): boolean;
	// n is the caller's draw index: reusing it repeats the draw, also across an alternate chain.
	rng(subject: EntityId, n: number, bound: number): number;
	rngCell(cell: Cell, n: number, bound: number): number;
}

export interface WriteCtx extends ReadCtx {
	kill(id: EntityId, cause: EntityId): void;
	spawn(species: SpeciesRef, x: number, y: number, cause: EntityId): void;
	emit(event: EventRef, cause: EntityId, a: number, b: number): void;
}

export interface ActionCtx extends WriteCtx {
	instead<K extends TargetKind>(
		action: ActionRef<K>,
		target: TargetOf[K],
	): typeof ALTERNATE;
}

export interface Perception {
	readonly count: number;
	slot(i: number): Slot;
	id(i: number): EntityId;
	dx(i: number): number;
	dy(i: number): number;
	dist(i: number): number;
}

export interface Candidates {
	push<K extends TargetKind>(
		action: ActionRef<K>,
		target: TargetOf[K],
		score: number,
	): void;
}

// `perception` is the actor's surroundings when the action runs, which for a cached
// decision may differ from what its proposal saw.
export type ActionFn<K extends TargetKind> = (
	ctx: ActionCtx,
	actor: Slot,
	target: TargetOf[K],
	perception: Perception,
) => number;
export type TickFn = (ctx: WriteCtx, floor: number) => void;
export type ProposeFn = (
	ctx: ReadCtx,
	actor: Slot,
	perception: Perception,
	out: Candidates,
) => void;

export interface FieldView<K extends FieldKind> {
	get(slot: Slot): FieldValue<K>;
}

export type ReadView<F extends Fields> = {
	readonly [K in keyof F]: FieldView<F[K]>;
};

// A cell column on the floor the context runs for: `cell` is that floor's own index.
// Reading NO_CELL gives zero, like stepping there fails; any other bad cell throws.
export interface CellField {
	get(ctx: ReadCtx, cell: Cell): number;
	set(ctx: WriteCtx, cell: Cell, value: number): void;
	clear(ctx: WriteCtx): void;
}

export type CellColumns<F extends Fields> = {
	readonly [K in keyof F]: CellField;
};

type NoCells = Readonly<Record<never, Fields>>;

export interface Builder<S extends Schema, K extends Schema = NoCells> {
	write<N extends keyof S & string>(name: N): Columns<S[N]>;
	cells<N extends keyof K & string>(name: N): CellColumns<K[N]>;
	// Undefined when no registered module owns the component.
	read<N extends keyof Contracts>(name: N): ReadView<Contracts[N]> | undefined;
	// A contract component only narrows the rows: the query grants no write access to it.
	query(names: readonly ((keyof S & string) | keyof Contracts)[]): Query;
	tick(run: TickFn): void;
	action<K extends TargetKind>(
		name: string,
		kind: K,
		run: ActionFn<K>,
	): ActionRef<K>;
	propose(run: ProposeFn): void;
	event(name: string): EventRef;
	// Resolved when the world is built: an unknown name throws there, not at the first spawn.
	species(wanted: string | SpeciesShape): SpeciesRef;
}

export interface ModuleDef<S extends Schema, C, K extends Schema = NoCells> {
	readonly name: string;
	readonly schema: S;
	readonly cells?: K;
	readonly config: C;
	setup(b: Builder<S, K>, cfg: C): void;
}

export type AnyModule = ModuleDef<Schema, unknown, Schema>;

export function defineModule<
	const S extends Schema,
	C,
	const K extends Schema = NoCells,
>(def: ModuleDef<S, C, K>): ModuleDef<S, C, K> {
	return def;
}
