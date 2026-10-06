import type { CellContracts, Contracts } from "../../contracts";
import type { Cell, EntityId, Slot } from "../ecs/ids";
import type { SlotList } from "../ecs/query";
import type {
	Columns,
	FieldKind,
	Fields,
	FieldValue,
	Schema,
} from "../ecs/schema";
import type { CoreSchema } from "../health/vitality";
import type { SpeciesShape } from "../lifecycle/species";

export { PERCEPTION_RADIUS } from "../config";
export { band } from "../decision/bands";
export { curve } from "../decision/curve";
export type { Cell, EntityId, Slot } from "../ecs/ids";
export { NO_CELL, NO_ENTITY, NONE } from "../ecs/ids";
export type { SlotList } from "../ecs/query";
export type { Schema } from "../ecs/schema";
export type { SpeciesShape } from "../lifecycle/species";

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
	// Leaves through the stairs (an entity with a link) next to or under the actor.
	readonly travel: ActionRef<"entity">;
	// A floor's cells are numbered y * width + x.
	readonly width: number;
	readonly height: number;
	isAlive(id: EntityId): boolean;
	slotOf(id: EntityId): Slot;
	idOf(slot: Slot): EntityId;
	x(slot: Slot): number;
	y(slot: Slot): number;
	cellAt(x: number, y: number): Cell;
	cellOf(slot: Slot): Cell;
	holdsActor(cell: Cell): boolean;
	// A free step that closes the Chebyshev distance to (x, y): the straight one first, else
	// the first in fixed neighbour order; NO_CELL when there is none.
	approach(actor: Slot, x: number, y: number): Cell;
	// The entities in a cell, in grid list order: NONE ends the walk.
	firstAt(cell: Cell): Slot;
	nextAt(slot: Slot): Slot;
	// n is the caller's draw index: reusing it repeats the draw, also across an alternate chain.
	rng(subject: EntityId, n: number, bound: number): number;
	rngCell(cell: Cell, n: number, bound: number): number;
}

export interface WriteCtx extends ReadCtx {
	kill(id: EntityId, cause: EntityId): void;
	// Applied by the core after this callback; a target without vitality ignores it.
	harm(target: EntityId, amount: number, cause: EntityId): void;
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
export type TickFn = (ctx: WriteCtx) => void;
export type ProposeFn = (
	ctx: ReadCtx,
	actor: Slot,
	perception: Perception,
	out: Candidates,
) => void;

export interface Query {
	has(slot: Slot): boolean;
	// The rows on ctx's floor. Fills one list shared by every call: never nest two loops
	// over the same query.
	slots(ctx: ReadCtx): SlotList;
}

export interface FieldView<K extends FieldKind> {
	get(slot: Slot): FieldValue<K>;
}

export type ReadView<F extends Fields> = {
	readonly [K in keyof F]: FieldView<F[K]>;
};

// One floor's slice of a cell column, valid in the current callback only.
export interface CellReader<K extends FieldKind> {
	// NO_CELL reads zero, like stepping there fails; any other cell off the floor throws.
	get(cell: Cell): FieldValue<K>;
	// The first cell after `cell` holding a nonzero value, or NO_CELL: start at NO_CELL.
	next(cell: Cell): Cell;
}

export interface CellWriter<K extends FieldKind> extends CellReader<K> {
	set(cell: Cell, value: FieldValue<K>): void;
	clear(): void;
}

export interface CellView<K extends FieldKind> {
	read(ctx: ReadCtx): CellReader<K>;
}

export interface CellField<K extends FieldKind> extends CellView<K> {
	write(ctx: WriteCtx): CellWriter<K>;
}

export type CellReadView<F extends Fields> = {
	readonly [K in keyof F]: CellView<F[K]>;
};

export type CellColumns<F extends Fields> = {
	readonly [K in keyof F]: CellField<F[K]>;
};

export type ContractView<N extends keyof Contracts | keyof CellContracts> =
	N extends keyof CellContracts
		? CellReadView<CellContracts[N]>
		: N extends keyof Contracts
			? ReadView<Contracts[N]>
			: never;

type NoCells = Readonly<Record<never, Fields>>;

export interface Builder<S extends Schema, K extends Schema = NoCells> {
	write<N extends keyof S & string>(name: N): Columns<S[N]>;
	cells<N extends keyof K & string>(name: N): CellColumns<K[N]>;
	// The core copies the owned cells here just before each of this module's ticks, so a tick
	// reads last round's values while it writes this round's. Readable in that tick only.
	previous<N extends keyof K & string>(name: N): CellReadView<K[N]>;
	// Undefined when no registered module owns the component or cells.
	read<N extends keyof Contracts | keyof CellContracts>(
		name: N,
	): ContractView<N> | undefined;
	// A contract component only narrows the rows: the query grants no write access to it.
	query(
		names: readonly ((keyof S & string) | keyof Contracts | keyof CoreSchema)[],
	): Query;
	tick(run: TickFn): void;
	// On an actor lacking any `requires` component the action is a FAIL; as for query, every
	// name must be owned by a registered module.
	action<K extends TargetKind>(
		name: string,
		kind: K,
		requires: readonly (
			| (keyof S & string)
			| keyof Contracts
			| keyof CoreSchema
		)[],
		run: ActionFn<K>,
	): ActionRef<K>;
	propose(run: ProposeFn): void;
	// Replaying actors with every component of `requires` decide in full while `field` is nonzero
	// at their cell. `field`: an own u8 cell field.
	alarm(
		field: CellField<"u8">,
		requires: readonly (
			| (keyof S & string)
			| keyof Contracts
			| keyof CoreSchema
		)[],
	): void;
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
