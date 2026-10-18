import type { Engine } from "../../src/core/engine";

// Earlier owners claim a buffer first: the pool before the dense columns that list its row
// pointers, the storage before the engine fields that alias its columns.
const owners = (e: Engine): [string, unknown][] => [
	["sparse pool", e.storage.sparse],
	["storage dense columns", e.storage.columns],
	["masks/index/free", e.storage],
	["scheduler", e.scheduler],
	["grid", e.grid],
	["sections", e.sections],
	["deferred lists", [e.kills, e.spawns, e.harms]],
	["other", e],
];

// Typed array bytes reachable from the engine, each ArrayBuffer counted once. Closures are not
// walked, so module scratch held only by a callback is missed; only query lists are added by hand.
export function allocated(e: Engine): {
	total: number;
	owners: { owner: string; bytes: number }[];
} {
	const visited = new Set<object>();
	const buffers = new Set<ArrayBufferLike>();
	const claim = (root: unknown) => {
		let bytes = 0;
		const stack = [root];
		while (stack.length > 0) {
			const value = stack.pop();
			if (typeof value !== "object" || value === null || visited.has(value))
				continue;
			visited.add(value);
			if (ArrayBuffer.isView(value)) {
				if (buffers.has(value.buffer)) continue;
				buffers.add(value.buffer);
				bytes += value.buffer.byteLength;
			} else if (value instanceof Map)
				for (const [k, v] of value) stack.push(k, v);
			else if (value instanceof Set) for (const v of value) stack.push(v);
			else for (const v of Object.values(value)) stack.push(v);
		}
		return bytes;
	};
	const claimed = owners(e).map(([owner, root]) => ({
		owner,
		bytes: claim(root),
	}));
	claimed.push({
		owner: "query lists",
		bytes: e.queries.reduce((sum, query) => sum + query.bytes, 0),
	});
	return {
		total: claimed.reduce((sum, { bytes }) => sum + bytes, 0),
		owners: claimed,
	};
}
