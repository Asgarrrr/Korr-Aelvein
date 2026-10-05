// Checked by `tsc` only. The core API is frozen: every interface below must stay identical,
// signatures included, so any change to it is a deliberate edit of this file.
import type { CellContracts, Contracts } from "../../src/contracts";
import {
	type ActionCtx,
	type ActionFn,
	type ActionRef,
	type ALTERNATE,
	type Builder,
	type Candidates,
	type Cell,
	type CellColumns,
	type CellField,
	type CellReader,
	type CellReadView,
	type CellView,
	type CellWriter,
	type ContractView,
	defineModule,
	type EntityId,
	type EventRef,
	type FieldView,
	type ModuleDef,
	type Perception,
	type ProposeFn,
	type Query,
	type ReadCtx,
	type ReadView,
	type Schema,
	type Slot,
	type SlotList,
	type SpeciesRef,
	type SpeciesShape,
	type TargetKind,
	type TargetOf,
	type TickFn,
	type WriteCtx,
} from "../../src/core/api";
import type {
	Columns,
	FieldKind,
	Fields,
	FieldValue,
} from "../../src/core/ecs/schema";
import type { CoreSchema } from "../../src/core/health/vitality";

type Equal<A, B> =
	(<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
		? true
		: false;

interface ReadCtxPin {
	readonly step: ActionRef<"cell">;
	readonly idle: ActionRef<"none">;
	readonly travel: ActionRef<"entity">;
	readonly width: number;
	readonly height: number;
	isAlive(id: EntityId): boolean;
	slotOf(id: EntityId): Slot;
	idOf(slot: Slot): EntityId;
	x(slot: Slot): number;
	y(slot: Slot): number;
	cellAt(x: number, y: number): Cell;
	holdsActor(cell: Cell): boolean;
	approach(actor: Slot, x: number, y: number): Cell;
	firstAt(cell: Cell): Slot;
	nextAt(slot: Slot): Slot;
	rng(subject: EntityId, n: number, bound: number): number;
	rngCell(cell: Cell, n: number, bound: number): number;
}
interface WriteCtxPin extends ReadCtxPin {
	kill(id: EntityId, cause: EntityId): void;
	harm(target: EntityId, amount: number, cause: EntityId): void;
	spawn(species: SpeciesRef, x: number, y: number, cause: EntityId): void;
	emit(event: EventRef, cause: EntityId, a: number, b: number): void;
}
interface ActionCtxPin extends WriteCtxPin {
	instead<K extends TargetKind>(
		action: ActionRef<K>,
		target: TargetOf[K],
	): typeof ALTERNATE;
}
interface PerceptionPin {
	readonly count: number;
	slot(i: number): Slot;
	id(i: number): EntityId;
	dx(i: number): number;
	dy(i: number): number;
	dist(i: number): number;
}
interface CandidatesPin {
	push<K extends TargetKind>(
		action: ActionRef<K>,
		target: TargetOf[K],
		score: number,
	): void;
}
interface QueryPin {
	has(slot: Slot): boolean;
	slots(ctx: ReadCtx): SlotList;
}
interface SlotListPin {
	readonly length: number;
	at(i: number): Slot;
}
interface FieldViewPin<K extends FieldKind> {
	get(slot: Slot): FieldValue<K>;
}
interface CellReaderPin<K extends FieldKind> {
	get(cell: Cell): FieldValue<K>;
	next(cell: Cell): Cell;
}
interface CellWriterPin<K extends FieldKind> extends CellReaderPin<K> {
	set(cell: Cell, value: FieldValue<K>): void;
	clear(): void;
}
interface CellViewPin<K extends FieldKind> {
	read(ctx: ReadCtx): CellReader<K>;
}
interface CellFieldPin<K extends FieldKind> extends CellViewPin<K> {
	write(ctx: WriteCtx): CellWriter<K>;
}
interface TargetOfPin {
	entity: EntityId;
	cell: Cell;
	none: null;
}
interface SpeciesShapePin {
	readonly actor: boolean;
	readonly components: {
		readonly [component: string]:
			| { readonly [field: string]: number | undefined }
			| undefined;
	};
}
interface BuilderPin<S extends Schema, K extends Schema> {
	write<N extends keyof S & string>(name: N): Columns<S[N]>;
	cells<N extends keyof K & string>(name: N): CellColumns<K[N]>;
	previous<N extends keyof K & string>(name: N): CellReadView<K[N]>;
	read<N extends keyof Contracts | keyof CellContracts>(
		name: N,
	): ContractView<N> | undefined;
	query(
		names: readonly ((keyof S & string) | keyof Contracts | keyof CoreSchema)[],
	): Query;
	tick(run: TickFn): void;
	action<A extends TargetKind>(
		name: string,
		kind: A,
		requires: readonly (
			| (keyof S & string)
			| keyof Contracts
			| keyof CoreSchema
		)[],
		run: ActionFn<A>,
	): ActionRef<A>;
	propose(run: ProposeFn): void;
	event(name: string): EventRef;
	species(wanted: string | SpeciesShape): SpeciesRef;
}
interface ModuleDefPin<S extends Schema, C, K extends Schema> {
	readonly name: string;
	readonly schema: S;
	readonly cells?: K;
	readonly config: C;
	setup(b: Builder<S, K>, cfg: C): void;
}

type Owned = { readonly mark: { readonly n: "u8" } };
type Cells = { readonly glow: { readonly v: "u8"; readonly who: "entity" } };
type Kinds<P extends Record<FieldKind, boolean>> = false extends P[FieldKind]
	? false
	: true;

export const surface: [
	Equal<ReadCtx, ReadCtxPin>,
	Equal<WriteCtx, WriteCtxPin>,
	Equal<ActionCtx, ActionCtxPin>,
	Equal<Perception, PerceptionPin>,
	Equal<Candidates, CandidatesPin>,
	Equal<Query, QueryPin>,
	Equal<SlotList, SlotListPin>,
	Equal<TargetOf, TargetOfPin>,
	Equal<SpeciesShape, SpeciesShapePin>,
	Equal<Builder<Schema, Schema>, BuilderPin<Schema, Schema>>,
	Equal<Builder<Owned, Cells>, BuilderPin<Owned, Cells>>,
	Equal<
		ModuleDef<Schema, unknown, Schema>,
		ModuleDefPin<Schema, unknown, Schema>
	>,
	Equal<
		ModuleDef<Owned, { r: 1 }, Cells>,
		ModuleDefPin<Owned, { r: 1 }, Cells>
	>,
	Kinds<{ [K in FieldKind]: Equal<FieldView<K>, FieldViewPin<K>> }>,
	Kinds<{ [K in FieldKind]: Equal<CellReader<K>, CellReaderPin<K>> }>,
	Kinds<{ [K in FieldKind]: Equal<CellWriter<K>, CellWriterPin<K>> }>,
	Kinds<{ [K in FieldKind]: Equal<CellView<K>, CellViewPin<K>> }>,
	Kinds<{ [K in FieldKind]: Equal<CellField<K>, CellFieldPin<K>> }>,
] = [
	true,
	true,
	true,
	true,
	true,
	true,
	true,
	true,
	true,
	true,
	true,
	true,
	true,
	true,
	true,
	true,
	true,
	true,
];

type NoCells = Readonly<Record<never, Fields>>;
// Mutable on purpose: a mapped type copies its source's modifiers, so only a mutable source shows
// whether the type itself adds readonly.
type Both = { v: "u8"; who: "entity" };
// A ref is a frozen, branded record: its one brand symbol holds the given value.
type Brand<R> = R[Extract<keyof R, symbol>];
type RefPin<R, Key extends string, B> = [
	Equal<R, Readonly<R>>,
	Equal<Exclude<keyof R, symbol>, Key>,
	Equal<R[Key & keyof R], number>,
	Equal<Brand<R>, B>,
];
type AllTrue<T extends readonly boolean[]> = false extends T[number]
	? false
	: true;
const inferred = defineModule({
	name: "inferred",
	schema: { a: { v: "u8" } },
	config: {},
	setup() {},
});

export const callbacks: [
	Equal<TickFn, (ctx: WriteCtx) => void>,
	Equal<
		ProposeFn,
		(ctx: ReadCtx, actor: Slot, perception: Perception, out: Candidates) => void
	>,
	AllTrue<
		[
			Equal<
				ActionFn<"entity">,
				(
					ctx: ActionCtx,
					actor: Slot,
					target: EntityId,
					perception: Perception,
				) => number
			>,
			Equal<
				ActionFn<"cell">,
				(
					ctx: ActionCtx,
					actor: Slot,
					target: Cell,
					perception: Perception,
				) => number
			>,
			Equal<
				ActionFn<"none">,
				(
					ctx: ActionCtx,
					actor: Slot,
					target: null,
					perception: Perception,
				) => number
			>,
		]
	>,
] = [true, true, true];

export const views: [
	Equal<
		ReadView<Both>,
		{ readonly v: FieldView<"u8">; readonly who: FieldView<"entity"> }
	>,
	Equal<
		CellReadView<Both>,
		{ readonly v: CellView<"u8">; readonly who: CellView<"entity"> }
	>,
	Equal<
		CellColumns<Both>,
		{ readonly v: CellField<"u8">; readonly who: CellField<"entity"> }
	>,
	Equal<Columns<Both>, { readonly v: Uint8Array; readonly who: Int32Array }>,
	Equal<ContractView<"diet">, ReadView<Contracts["diet"]>>,
	Equal<ContractView<"satiety">, ReadView<Contracts["satiety"]>>,
	Equal<ContractView<"edible">, ReadView<Contracts["edible"]>>,
	Equal<ContractView<"fire">, CellReadView<CellContracts["fire"]>>,
	Equal<
		Schema,
		{ readonly [name: string]: { readonly [field: string]: FieldKind } }
	>,
] = [true, true, true, true, true, true, true, true, true];

declare const kind: "cell";
export const refs: [
	AllTrue<RefPin<ActionRef<typeof kind>, "index", "cell">>,
	AllTrue<RefPin<EventRef, "key", true>>,
	AllTrue<RefPin<SpeciesRef, "index", true>>,
] = [true, true, true];

export const defaults: [
	Equal<Builder<Owned>, BuilderPin<Owned, NoCells>>,
	Equal<ModuleDef<Owned, { r: 1 }>, ModuleDefPin<Owned, { r: 1 }, NoCells>>,
	Equal<
		typeof defineModule,
		<const S extends Schema, C, const K extends Schema = NoCells>(
			def: ModuleDef<S, C, K>,
		) => ModuleDef<S, C, K>
	>,
	Equal<typeof inferred.schema, { readonly a: { readonly v: "u8" } }>,
] = [true, true, true, true];
