import { CAP, ID_FLOOR_STRIDE } from "../config";
import { ALIVE } from "../ecs/storage";
import type { Engine } from "../engine";
import { ID } from "../travel/inbox";

// Each floor checks only its own rows; across floors an id must live in one place and have been
// issued by its origin floor.
export function identityProblem(engine: Engine): string | undefined {
	const { storage, inbox } = engine;
	const { floors, masks, maskWords, ids, highWater, counters } = storage;
	let total = 0;
	for (let f = 0; f < floors; f++)
		total += (highWater[f] ?? 0) + inbox.count(f);
	const all = new Int32Array(total);
	let n = 0;
	for (let f = 0; f < floors; f++) {
		const end = f * CAP + (highWater[f] ?? 0);
		for (let s = f * CAP; s < end; s++)
			if (((masks[s * maskWords] ?? 0) & ALIVE) !== 0) all[n++] = ids[s] ?? 0;
		const list = inbox.words(f);
		for (let i = 0; i < inbox.count(f); i++)
			all[n++] = list[i * inbox.width + ID] ?? 0;
	}
	const seen = all.subarray(0, n).sort();
	for (let i = 0; i < n; i++) {
		const id = seen[i] ?? 0;
		if (i > 0 && seen[i - 1] === id) return `id ${id} lives twice`;
		const origin = Math.floor(id / ID_FLOOR_STRIDE);
		if (id - origin * ID_FLOOR_STRIDE > (counters[origin] ?? 0))
			return `id ${id} was never issued by floor ${origin}`;
	}
	return undefined;
}
