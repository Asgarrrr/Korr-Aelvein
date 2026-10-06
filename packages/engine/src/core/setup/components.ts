import type { Column } from "../ecs/schema";
import type { Engine } from "../engine";
import type { AnyModule } from "../module/api";
import { hashName } from "../random/rng";

export function registerComponents(
	engine: Engine,
	modules: readonly AnyModule[],
): void {
	for (const module of modules) {
		const ownerKey = hashName(module.name);
		for (const [name, fields] of Object.entries(module.schema)) {
			const columns: Record<string, Column> = {};
			for (const [field, kind] of Object.entries(fields))
				columns[field] = engine.storage.column(kind);
			engine.components.set(name, {
				bit: engine.storage.componentBit(engine.components.size),
				columns: Object.freeze(columns),
				ownerKey,
			});
		}
	}
}
