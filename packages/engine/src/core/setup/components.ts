import type { Column } from "../ecs/schema";
import type { Engine } from "../engine";
import type { AnyModule } from "../module/api";
import { hashName } from "../random/rng";

export function registerComponents(
	engine: Engine,
	modules: readonly AnyModule[],
): void {
	const { storage } = engine;
	for (const module of modules) {
		const ownerKey = hashName(module.name);
		const pooled = sparseNames(module);
		for (const [name, fields] of Object.entries(module.schema)) {
			const sparse = pooled.has(name);
			const columns: Record<string, Column> = {};
			for (const [field, kind] of Object.entries(fields))
				columns[field] = sparse
					? storage.sparse.column(kind)
					: storage.column(kind);
			const bit = storage.componentBit(engine.components.size);
			const { sparseMask } = engine;
			if (sparse) sparseMask[bit.word] = (sparseMask[bit.word] ?? 0) | bit.bit;
			engine.components.set(name, {
				bit,
				columns: Object.freeze(columns),
				ownerKey,
				sparse,
			});
		}
	}
}

function sparseNames(module: AnyModule): Set<string> {
	const names = new Set<string>();
	for (const name of module.sparse ?? []) {
		if (!Object.hasOwn(module.schema, name))
			throw new Error(
				`${module.name} lists sparse ${name}, which it does not own`,
			);
		if (names.has(name))
			throw new Error(`${module.name} lists sparse ${name} twice`);
		names.add(name);
	}
	return names;
}
