import type { Contracts } from "../../contracts";
import type {
	ActionFn,
	ActionRef,
	AnyModule,
	Builder,
	CellColumns,
	CellField,
	EventRef,
	ProposeFn,
	Query,
	ReadView,
	SpeciesRef,
	TargetKind,
	TickFn,
} from "../api";
import { Audit } from "../audit/audit";
import { checked } from "../audit/checked";
import { MaskQuery } from "../ecs/query";
import type { Column, Columns, Schema } from "../ecs/schema";
import { createColumn } from "../ecs/schema";
import { readView } from "../ecs/view";
import { CORE, CORE_KEY, Engine } from "../engine";
import { compileSpecies, type SpeciesShape } from "../lifecycle/species";
import { sectionsOf } from "../persistence/image";
import { hashName } from "../random/rng";
import { CellColumn } from "../space/cells";
import { canonical, frozenCopy } from "./canonical";

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
	const componentNames: string[] = [];
	const owners = new Map<string, string>();
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

	const engine = new Engine({
		...shape,
		componentCount: componentNames.length,
	});
	for (const module of modules) {
		for (const [name, fields] of Object.entries(module.schema)) {
			const columns: Record<string, Column> = {};
			for (const [field, kind] of Object.entries(fields))
				columns[field] = engine.storage.column(kind);
			engine.components.set(name, {
				bit: engine.storage.componentBit(engine.components.size),
				columns: Object.freeze(columns),
			});
		}
	}
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
	const table = new Map<string, string>();
	for (const [name, shape] of Object.entries(species))
		table.set(name, speciesData(copyOf(shape), `species ${name}`));
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
			const { components, storage } = engine;
			engine.species.push(compileSpecies(copy, components, storage.maskWords));
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
		`[${configs.join(",")}]{${named.join(",")}}[${resolved.join(",")}]`,
	);
	engine.sections = sectionsOf(engine);
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
		const module = this.#open();
		const columns = this.#engine.cellColumns.get(name);
		if (!columns || !Object.hasOwn(module.cells ?? {}, name))
			throw new Error(`${module.name} does not own cells ${name}`);
		const { grid } = this.#engine;
		const fields: Record<string, CellField> = {};
		for (const [field, column] of Object.entries(columns)) {
			const array = this.#audit ? checked(column, `${name}.${field}`) : column;
			fields[field] = new CellColumn(array, grid.stride, grid.cells);
		}
		return Object.freeze(fields) as CellColumns<Schema[N]>;
	}

	read<N extends keyof Contracts>(name: N): ReadView<Contracts[N]> | undefined {
		const module = this.#open();
		if (Object.hasOwn(module.schema, name))
			throw new Error(`${module.name} owns ${name}: use write, not read`);
		const component = this.#engine.components.get(name);
		if (!component) return undefined;
		return readView(component.columns) as ReadView<Contracts[N]>;
	}

	query(names: readonly string[]): Query {
		const module = this.#open();
		return new MaskQuery(
			this.#engine.storage,
			names.map((name) => {
				const component = this.#engine.components.get(name);
				if (!component)
					throw new Error(
						`${module.name} queries ${name}, which no module owns`,
					);
				return component.bit;
			}),
		);
	}

	tick(run: TickFn): void {
		this.#open();
		this.#engine.ticks.push({ moduleKey: this.#moduleKey, run });
	}

	action<K extends TargetKind>(
		name: string,
		kind: K,
		run: ActionFn<K>,
	): ActionRef<K> {
		const full = `${this.#open().name}/${name}`;
		return this.#engine.addAction(this.#moduleKey, full, kind, run);
	}

	propose(run: ProposeFn): void {
		this.#open();
		this.#engine.proposers.push({ moduleKey: this.#moduleKey, run });
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

	#owned(name: string) {
		const module = this.#open();
		const component = this.#engine.components.get(name);
		if (!component || !Object.hasOwn(module.schema, name))
			throw new Error(`${module.name} does not own ${name}`);
		return component;
	}
}

Object.freeze(ModuleBuilder.prototype);
