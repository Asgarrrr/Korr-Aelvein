import type {
	ActionFn,
	ActionRef,
	AnyModule,
	Builder,
	EventRef,
	ProposeFn,
	Query,
	SpeciesRef,
	TargetKind,
	TickFn,
} from "./api";
import { canonical, frozenCopy } from "./canonical";
import { CORE, CORE_KEY, Engine } from "./engine";
import { sectionsOf } from "./image";
import { MaskQuery } from "./query";
import { hashName } from "./rng";
import type { Column, Columns, Schema } from "./schema";
import { compileSpecies, type SpeciesShape } from "./species";

export interface WorldShape {
	readonly seed: number;
	readonly floors: number;
	readonly width: number;
	readonly height: number;
	readonly popCap: number;
	readonly events: boolean;
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
		for (const component of Object.keys(module.schema)) {
			const owner = owners.get(component);
			if (owner)
				throw new Error(
					`${component} is owned by both ${owner} and ${module.name}`,
				);
			owners.set(component, module.name);
			componentNames.push(component);
		}
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
				columns,
			});
		}
	}
	// Every component exists before any setup runs, so a species may name a later module's component.
	const table = new Map<string, string>();
	for (const [name, shape] of Object.entries(species))
		table.set(name, speciesData(shape, `species ${name}`));
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
			resolved.push(speciesData(shape, `${module.name} species`));
			ref = { index: engine.species.length } as SpeciesRef;
			const { components, storage } = engine;
			engine.species.push(
				compileSpecies(frozenCopy(shape), components, storage.maskWords),
			);
			refs.set(shape, ref);
		}
		return ref;
	};
	const configs: string[] = [];
	for (const module of modules) {
		configs.push(
			canonical([module.name, module.schema, module.config], module.name),
		);
		const builder = new ModuleBuilder(
			engine,
			module,
			hashName(module.name),
			(wanted) => resolve(module, wanted),
		);
		module.setup(builder, frozenCopy(module.config));
	}
	// Config and species decide future behaviour, so a save only loads into a world that agrees on them.
	const named = [...table.keys()]
		.sort()
		.map((name) => `${JSON.stringify(name)}:${table.get(name)}`);
	engine.fingerprint = hashName(
		`[${configs.join(",")}]{${named.join(",")}}[${resolved.join(",")}]`,
	);
	engine.sections = sectionsOf(engine);
	return engine;
}

// A species as data: `actor` is the one boolean, so it is checked here and written as 0 or 1.
function speciesData(shape: SpeciesShape, path: string): string {
	if (typeof shape.actor !== "boolean")
		throw new Error(`${path}.actor is not a boolean`);
	const actor = shape.actor ? 1 : 0;
	return canonical({ actor, components: shape.components }, path);
}

class ModuleBuilder implements Builder<Schema> {
	constructor(
		private readonly engine: Engine,
		private readonly module: AnyModule,
		private readonly moduleKey: number,
		readonly species: (wanted: string | SpeciesShape) => SpeciesRef,
	) {}

	write<N extends string>(name: N): Columns<Schema[N]> {
		return this.owned(name).columns as Columns<Schema[N]>;
	}

	query(names: readonly string[]): Query {
		return new MaskQuery(
			this.engine.storage,
			names.map((name) => this.owned(name).bit),
		);
	}

	tick(run: TickFn): void {
		this.engine.ticks.push({ moduleKey: this.moduleKey, run });
	}

	action<K extends TargetKind>(
		name: string,
		kind: K,
		run: ActionFn<K>,
	): ActionRef<K> {
		const key = hashName(`${this.module.name}/${name}`);
		return this.engine.addAction(this.moduleKey, key, kind, run);
	}

	propose(run: ProposeFn): void {
		this.engine.proposers.push({ moduleKey: this.moduleKey, run });
	}

	event(name: string): EventRef {
		return this.engine.addEvent(`${this.module.name}/${name}`);
	}

	private owned(name: string) {
		const component = this.engine.components.get(name);
		if (!component || !Object.hasOwn(this.module.schema, name))
			throw new Error(`${this.module.name} does not own ${name}`);
		return component;
	}
}
