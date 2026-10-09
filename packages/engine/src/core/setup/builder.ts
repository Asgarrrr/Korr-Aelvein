import type { CellContracts, Contracts } from "../../contracts";
import { checked } from "../audit/checked";
import { MaskBits } from "../ecs/mask";
import { MaskQuery } from "../ecs/query";
import type { Column, Columns, FieldKind, Schema } from "../ecs/schema";
import { createColumn } from "../ecs/schema";
import type { MaskBit } from "../ecs/storage";
import { readView } from "../ecs/view";
import type { Buffer, Engine } from "../engine";
import type { SpeciesShape } from "../lifecycle/species";
import type {
	ActionFn,
	ActionRef,
	AnyModule,
	Builder,
	CellColumns,
	CellField,
	CellReadView,
	CellView,
	ContractView,
	EventRef,
	ProposeFn,
	Query,
	SpeciesRef,
	TargetKind,
	TickFn,
} from "../module/api";
import { cellField, cellView } from "../space/cells";

// A module keeps its builder past setup at will, so every call checks the seal.
export class ModuleBuilder implements Builder<Schema, Schema> {
	readonly #engine: Engine;
	readonly #module: AnyModule;
	readonly #moduleKey: number;
	readonly #resolve: (wanted: string | SpeciesShape) => SpeciesRef;
	readonly #audit: boolean;
	readonly #buffers: Buffer[] = [];
	#sealed = false;

	constructor(
		engine: Engine,
		module: AnyModule,
		moduleKey: number,
		resolve: (wanted: string | SpeciesShape) => SpeciesRef,
		audit: boolean,
	) {
		this.#engine = engine;
		this.#module = module;
		this.#moduleKey = moduleKey;
		this.#resolve = resolve;
		this.#audit = audit;
	}

	seal(): void {
		this.#sealed = true;
	}

	write<N extends string>(name: N): Columns<Schema[N]> {
		const { columns } = this.#owned(name);
		if (!this.#audit) return columns as Columns<Schema[N]>;
		const wrapped: Record<string, Column> = {};
		for (const [field, column] of Object.entries(columns))
			wrapped[field] = checked(column, `${name}.${field}`);
		return Object.freeze(wrapped) as Columns<Schema[N]>;
	}

	cells<N extends string>(name: N): CellColumns<Schema[N]> {
		const columns = this.#ownedCells(name);
		const { grid } = this.#engine;
		const fields: Record<string, CellField<FieldKind>> = {};
		for (const [field, column] of Object.entries(columns)) {
			const audit = this.#audit ? `${name}.${field}` : undefined;
			fields[field] = cellField(column, grid.stride, grid.cells, audit);
		}
		return Object.freeze(fields) as CellColumns<Schema[N]>;
	}

	previous<N extends string>(name: N): CellReadView<Schema[N]> {
		const columns = this.#ownedCells(name);
		const kinds = this.#module.cells?.[name] ?? {};
		const { grid, storage } = this.#engine;
		const views: Record<string, CellView<FieldKind>> = {};
		for (const [field, current] of Object.entries(columns)) {
			if (this.#buffers.some((buffer) => buffer.current === current))
				throw new Error(`${name} is already buffered`);
			const kind = kinds[field] ?? "i32";
			const previous = createColumn(kind, storage.floors * grid.stride);
			this.#buffers.push({ current, previous });
			views[field] = cellView(
				previous,
				grid.stride,
				grid.cells,
				this.#moduleKey,
			);
		}
		return Object.freeze(views) as CellReadView<Schema[N]>;
	}

	read<N extends keyof Contracts | keyof CellContracts>(
		name: N,
	): ContractView<N> | undefined {
		const module = this.#open();
		if (
			Object.hasOwn(module.schema, name) ||
			Object.hasOwn(module.cells ?? {}, name)
		)
			throw new Error(`${module.name} owns ${name}: use write, not read`);
		const { grid, cellColumns, components } = this.#engine;
		const cells = cellColumns.get(name);
		if (cells) {
			const views: Record<string, CellView<FieldKind>> = {};
			for (const [field, column] of Object.entries(cells))
				views[field] = cellView(column, grid.stride, grid.cells);
			return Object.freeze(views) as ContractView<N>;
		}
		const component = components.get(name);
		if (!component) return undefined;
		return readView(component.columns) as ContractView<N>;
	}

	query(names: readonly string[]): Query {
		// The core hands modules only its own contexts, which carry the floor slots() reads.
		const query = new MaskQuery(
			this.#engine.storage,
			this.#bits(names, "queries"),
		);
		return query as unknown as Query;
	}

	tick(run: TickFn): void {
		this.#open();
		// Shared with `previous`, which may be called after `tick` during setup.
		const buffers = this.#buffers;
		this.#engine.ticks.push({ moduleKey: this.#moduleKey, run, buffers });
	}

	action<K extends TargetKind>(
		name: string,
		kind: K,
		requires: readonly string[],
		run: ActionFn<K>,
	): ActionRef<K> {
		const full = `${this.#open().name}/${name}`;
		const { storage } = this.#engine;
		const mask = new MaskBits(storage, this.#bits(requires, "requires"));
		return this.#engine.addAction(this.#moduleKey, full, kind, mask, run);
	}

	propose(run: ProposeFn): void {
		this.#open();
		this.#engine.proposers.push({ moduleKey: this.#moduleKey, run });
	}

	alarm(table: string, field: string, requires: readonly string[]): void {
		const columns = this.#ownedCells(table);
		const column = Object.hasOwn(columns, field) ? columns[field] : undefined;
		if (!(column instanceof Uint8Array))
			throw new Error(
				`${this.#module.name} alarm: ${table}.${field} is not a u8 cell field`,
			);
		const bits = this.#bits(requires, "requires");
		this.#engine.addAlarm(this.#moduleKey, column, bits);
	}

	event(name: string): EventRef {
		return this.#engine.addEvent(`${this.#open().name}/${name}`);
	}

	species(wanted: string | SpeciesShape): SpeciesRef {
		this.#open();
		return this.#resolve(wanted);
	}

	#open(): AnyModule {
		if (this.#sealed)
			throw new Error(`${this.#module.name} used its builder after setup`);
		return this.#module;
	}

	#bits(names: readonly string[], verb: string): MaskBit[] {
		const module = this.#open();
		return names.map((name) => {
			const component = this.#engine.components.get(name);
			if (!component)
				throw new Error(`${module.name} ${verb} ${name}, which no module owns`);
			return component.bit;
		});
	}

	#ownedCells(name: string): Readonly<Record<string, Column>> {
		const module = this.#open();
		const columns = this.#engine.cellColumns.get(name);
		if (!columns || !Object.hasOwn(module.cells ?? {}, name))
			throw new Error(`${module.name} does not own cells ${name}`);
		return columns;
	}

	#owned(name: string) {
		const module = this.#open();
		const component = this.#engine.components.get(name);
		if (!component || !Object.hasOwn(module.schema, name))
			throw new Error(`${module.name} does not own ${name}`);
		return component;
	}
}

Object.freeze(ModuleBuilder.prototype);
