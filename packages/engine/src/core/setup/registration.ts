import { Audit } from "../audit/audit";
import { MAX_SPECIES } from "../config";
import type { Column } from "../ecs/schema";
import { createColumn } from "../ecs/schema";
import { CORE, CORE_KEY, Engine } from "../engine";
import { coreSchema } from "../health/vitality";
import {
	type CompiledSpecies,
	compileSpecies,
	type SpeciesShape,
} from "../lifecycle/species";
import type { AnyModule, SpeciesRef } from "../module/api";
import { sectionsOf } from "../persistence/image";
import { hashName } from "../random/rng";
import { Inbox } from "../travel/inbox";
import { ModuleBuilder } from "./builder";
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
				[
					module.name,
					module.schema,
					module.cells ?? {},
					module.sparse ?? [],
					config,
				],
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
