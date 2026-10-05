import type { Cell, EntityId, Slot } from "./ecs/ids";
import type { Query } from "./ecs/query";
import type { Columns, Schema } from "./ecs/schema";
import type { SpeciesShape } from "./lifecycle/species";

export type { Cell, EntityId, Slot } from "./ecs/ids";
export { NONE } from "./ecs/ids";
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

export type ActionFn<K extends TargetKind> = (
	ctx: ActionCtx,
	actor: Slot,
	target: TargetOf[K],
) => number;
export type TickFn = (ctx: WriteCtx, floor: number) => void;
export type ProposeFn = (
	ctx: ReadCtx,
	actor: Slot,
	perception: Perception,
	out: Candidates,
) => void;

export interface Builder<S extends Schema> {
	write<N extends keyof S & string>(name: N): Columns<S[N]>;
	query(names: readonly (keyof S & string)[]): Query;
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

export interface ModuleDef<S extends Schema, C> {
	readonly name: string;
	readonly schema: S;
	readonly config: C;
	setup(b: Builder<S>, cfg: C): void;
}

export type AnyModule = ModuleDef<Schema, unknown>;

export function defineModule<const S extends Schema, C>(
	def: ModuleDef<S, C>,
): ModuleDef<S, C> {
	return def;
}
