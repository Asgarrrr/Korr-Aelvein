import { MAX_TICK } from "../config";
import type { Column } from "../ecs/schema";
import { ACTOR, ALIVE, indexHas, knownBits } from "../ecs/storage";
import { type Engine, KIND_CODE } from "../engine";
import { healthy } from "../health/vitality";
import { ENTRY_HEAD, ID, TIME, X, Y } from "../travel/inbox";
import { validTarget } from "../turns/target";

// An inbox holds only what a departure writes: actors sorted by (time, id), ids no row of the
// floor holds, arrival cells on the floor, and nothing in a component the entity lacks.
export function inboxProblem(
	engine: Engine,
	entries: Int32Array,
	count: number,
	rows: {
		readonly index: Int32Array;
		readonly ids: Int32Array;
		readonly base: number;
	},
): string | undefined {
	if (count === 0) return undefined;
	const { storage, grid, carried, components, vitality } = engine;
	const width = engine.inbox.width;
	const words = storage.maskWords;
	const known = knownBits(words, components.size);
	const slotOf = new Map<Column, number>(carried.map((c, i) => [c, i]));
	const seen = new Set<number>();
	for (let n = 0; n < count; n++) {
		const at = n * width;
		const time = entries[at + TIME] ?? 0;
		const id = entries[at + ID] ?? 0;
		const where = `inbox entry ${n} (id ${id})`;
		if (n > 0) {
			const t = entries[at - width + TIME] ?? 0;
			if (!(t < time || (t === time && (entries[at - width + ID] ?? 0) < id)))
				return `${where} is out of (time, id) order`;
		}
		if (!(time >= 0 && time <= MAX_TICK)) return `${where} arrives at ${time}`;
		if (!validTarget(KIND_CODE.entity, id, 0, storage.floors) || seen.has(id))
			return `${where} has a bad or repeated id`;
		if (indexHas(rows.index, 0, rows.ids, rows.base, id))
			return `id ${id} is both on the floor and in its inbox`;
		seen.add(id);
		const x = entries[at + X] ?? 0;
		const y = entries[at + Y] ?? 0;
		if (!(x >= 0 && x < grid.width && y >= 0 && y < grid.height))
			return `${where} arrives off the floor`;
		const mask = entries[at + ENTRY_HEAD] ?? 0;
		if ((mask & (ALIVE | ACTOR)) !== (ALIVE | ACTOR))
			return `${where} is not a living actor`;
		for (let w = 0; w < words; w++)
			if (((entries[at + ENTRY_HEAD + w] ?? 0) & ~(known[w] ?? 0)) !== 0)
				return `${where} has unknown mask bits`;
		const body = at + ENTRY_HEAD + words;
		for (const [name, { bit, columns }] of components) {
			const has = ((entries[at + ENTRY_HEAD + bit.word] ?? 0) & bit.bit) !== 0;
			if (has && name === "link") return `${where} is an actor with a link`;
			if (has) continue;
			for (const column of Object.values(columns))
				if (entries[body + (slotOf.get(column) ?? 0)] !== 0)
					return `${where} keeps a value in ${name}, a component it does not have`;
		}
		const lives =
			((entries[at + ENTRY_HEAD + vitality.word] ?? 0) & vitality.bit) !== 0;
		const hp = entries[body + (slotOf.get(vitality.hp) ?? 0)] ?? 0;
		const max = entries[body + (slotOf.get(vitality.max) ?? 0)] ?? 0;
		if (lives && !healthy(hp, max)) return `${where} has hp ${hp} of ${max}`;
	}
	return undefined;
}
