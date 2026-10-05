import type {
	ActionFn,
	ActionRef,
	AnyModule,
	Builder,
	ProposeFn,
	Query,
	TargetKind,
	TickFn,
} from "./api";
import { CORE, CORE_KEY, Engine } from "./engine";
import { MaskQuery } from "./query";
import { hashName } from "./rng";
import type { Column, Columns, Schema } from "./schema";

export interface WorldShape {
	readonly seed: number;
	readonly floors: number;
	readonly width: number;
	readonly height: number;
}

export function createEngine(
	shape: WorldShape,
	modules: readonly AnyModule[],
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
		const builder = new ModuleBuilder(engine, module, hashName(module.name));
		module.setup(builder, module.config);
	}
	return engine;
}

class ModuleBuilder implements Builder<Schema> {
	constructor(
		private readonly engine: Engine,
		private readonly module: AnyModule,
		private readonly moduleKey: number,
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

	private owned(name: string) {
		const component = this.engine.components.get(name);
		if (!component || !Object.hasOwn(this.module.schema, name))
			throw new Error(`${this.module.name} does not own ${name}`);
		return component;
	}
}
