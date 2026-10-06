import type { CellContracts, Contracts } from "../../contracts";
import { Audit } from "../audit/audit";
import { checked } from "../audit/checked";
import { MAX_SPECIES } from "../config";
import { MaskBits } from "../ecs/mask";
import { MaskQuery } from "../ecs/query";
import type { Column, Columns, FieldKind, Schema } from "../ecs/schema";
import { createColumn } from "../ecs/schema";
import type { MaskBit } from "../ecs/storage";
import { readView } from "../ecs/view";
import { type Buffer, CORE, CORE_KEY, Engine } from "../engine";
import { coreSchema } from "../health/vitality";
import {
	type CompiledSpecies,
	compileSpecies,
	type SpeciesShape,
} from "../lifecycle/species";
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
import { sectionsOf } from "../persistence/image";
import { hashName } from "../random/rng";
import { cellField, cellView } from "../space/cells";
import { Inbox } from "../travel/inbox";
import { canonical, frozenCopy } from "./canonical";
import { registerComponents } from "./components";

export interface WorldShape {
	readonly seed: number;
	readonly floors: number;
	readonly width: number;
	readonly height: number;
	readonly popCap: number;
	readonly events: boolean;
	// Tests and debugging only: it copies the floor's columns around every callback.
	readonly audit?: boolean;
}

export function createEngine(
	shape: WorldShape,
	modules: readonly AnyModule[],
	species: Readonly<Record<string, SpeciesShape>> = {},
): Engine {
	const names = new Set<string>([CORE]);
	const keys = new Set<number>([CORE_KEY]);
	const componentNames = Object.keys(coreSchema);
	const owners = new Map(componentNames.map((name) => [name, CORE]));
	for (const module of modules) {
		if (names.has(module.name))
			throw new Error(`duplicate module name ${module.name}`);
		names.add(module.name);
		const key = hashName(module.name);
		if (keys.has(key))
			throw new Error(`module key collision on ${module.name}`);
		keys.add(key);
		for (const component of [
			...Object.keys(module.schema),
			...Object.keys(module.cells ?? {}),
		]) {
			const owner = owners.get(component);
			if (owner)
				throw new Error(
					`${component} is owned by both ${owner} and ${module.name}`,
				);
			owners.set(component, module.name);
		}
		componentNames.push(...Object.keys(module.schema));
	}

	const speciesNames = Object.keys(species).sort();
	if (speciesNames.length > MAX_SPECIES)
		throw new Error(`more than ${MAX_SPECIES} species`);
	const engine = new Engine({
		...shape,
		componentCount: componentNames.length,
		speciesNames,
	});
	registerComponents(engine, modules);
	const { floors } = shape;
	for (const module of modules) {
		for (const [name, fields] of Object.entries(module.cells ?? {})) {
			const columns: Record<string, Column> = {};
			for (const [field, kind] of Object.entries(fields))
				columns[field] = createColumn(kind, floors * engine.grid.stride);
			engine.cellColumns.set(name, Object.freeze(columns));
		}
	}
	// Every component exists before any setup runs, so a species may name a later module's component.
	// Read once: a getter could otherwise hand the fingerprint and the spawns two shapes.
	const copies = new Map<SpeciesShape, SpeciesShape>();
	const copyOf = (shape: SpeciesShape) => {
		let copy = copies.get(shape);
		if (!copy) {
			copy = frozenCopy(shape);
			copies.set(shape, copy);
		}
		return copy;
	};
	const compiled = new Map<SpeciesShape, CompiledSpecies>();
	const compiledOf = (shape: SpeciesShape, label: string, index?: number) => {
		let entry = compiled.get(shape);
		if (!entry) {
			const { components, storage } = engine;
			entry = compileSpecies(
				copyOf(shape),
				components,
				storage.maskWords,
				label,
				index,
			);
			compiled.set(shape, entry);
		}
		return entry;
	};
	const table = new Map<string, string>();
	// One compiled entry per shape object: a second name for it would list as the first.
	const nameOf = new Map<SpeciesShape, string>();
	for (const [i, name] of speciesNames.entries()) {
		const shape = species[name] as SpeciesShape;
		const twin = nameOf.get(shape);
		if (twin !== undefined)
			throw new Error(`species ${twin} and ${name} are the same object`);
		nameOf.set(shape, name);
		table.set(name, speciesData(copyOf(shape), `species ${name}`));
		engine.speciesByName.set(name, compiledOf(shape, `species ${name}`, i + 1));
	}
	const refs = new Map<SpeciesShape, SpeciesRef>();
	const resolved: string[] = [];
	const resolve = (module: AnyModule, wanted: string | SpeciesShape) => {
		const shape =
			typeof wanted !== "string"
				? wanted
				: Object.hasOwn(species, wanted)
					? species[wanted]
					: undefined;
		if (!shape)
			throw new Error(
				`${module.name} spawns ${wanted}, which this world does not define`,
			);
		let ref = refs.get(shape);
		if (!ref) {
			const copy = copyOf(shape);
			resolved.push(speciesData(copy, `${module.name} species`));
			ref = Object.freeze({ index: engine.species.length }) as SpeciesRef;
			engine.species.push(compiledOf(shape, `${module.name} species`));
			refs.set(shape, ref);
		}
		return ref;
	};
	const configs: string[] = [];
	for (const module of modules) {
		// Read once: a getter could otherwise hand the fingerprint and the module two values.
		const config = frozenCopy(module.config);
		configs.push(
			canonical(
				[module.name, module.schema, module.cells ?? {}, config],
				module.name,
			),
		);
		const builder = new ModuleBuilder(
			engine,
			module,
			hashName(module.name),
			(wanted) => resolve(module, wanted),
			shape.audit ?? false,
		);
		module.setup(builder, config);
		builder.seal();
	}
	// Config and species decide future behaviour, so a save only loads into a world that agrees on them.
	const named = [...table.keys()]
		.sort()
		.map((name) => `${JSON.stringify(name)}:${table.get(name)}`);
	engine.fingerprint = hashName(
		`${canonical(coreSchema, CORE)}[${configs.join(",")}]{${named.join(",")}}[${resolved.join(",")}]`,
	);
	engine.sections = sectionsOf(engine);
	const { storage } = engine;
	const local = new Set<Column>(
		engine.coreColumns.filter((c) => !c.travels).map((c) => c.column),
	);
	engine.carried = storage.columns.filter((column) => !local.has(column));
	engine.inbox = new Inbox(storage, engine.carried);
	if (shape.audit) engine.audit = new Audit(engine, modules);
	return engine;
}

// A species as data: `actor` is the one boolean, so it is checked here and written as 0 or 1.
function speciesData(shape: SpeciesShape, path: string): string {
	if (typeof shape.actor !== "boolean")
		throw new Error(`${path}.actor is not a boolean`);
	const actor = shape.actor ? 1 : 0;
	return canonical({ actor, components: shape.components }, path);
}

// A module keeps its builder past setup at will, so every call checks the seal.
class ModuleBuilder implements Builder<Schema, Schema> {
	readonly #engine: Engine;
	readonly #module: AnyModule;
	readonly #moduleKey: number;
	readonly #resolve: (wanted: string | SpeciesShape) => SpeciesRef;
	readonly #audit: boolean;
	readonly #buffers: Buffer[] = [];
	readonly #cellFields = new Map<CellField<FieldKind>, Column>();
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
			const view = cellField(column, grid.stride, grid.cells, audit);
			this.#cellFields.set(view, column);
			fields[field] = view;
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

	alarm(field: CellField<"u8">, requires: readonly string[]): void {
		const column = this.#cellFields.get(field);
		if (!(column instanceof Uint8Array))
			throw new Error(`${this.#open().name} alarm: not an owned u8 cell`);
		this.#engine.addAlarm(column, this.#bits(requires, "requires"));
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
