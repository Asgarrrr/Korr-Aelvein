import { expect, test } from "bun:test";
import type { EntityId, Slot } from "../../src/core/api";
import { CAP } from "../../src/core/config";
import { NONE } from "../../src/core/ids";
import { INDEX_SIZE, Storage } from "../../src/core/storage";

// Randomized churn, checked against a Map: every id ever issued, alive or dead, on both floors.
test("the id index agrees with a Map through heavy churn", () => {
	const FLOORS = 2;
	const STEPS = 40_000;
	const storage = new Storage(FLOORS, 0);
	const truth = new Map<number, { floor: number; slot: Slot }>();
	const live: number[][] = [[], []];
	let s = 7;
	const rand = (n: number) => {
		s = (Math.imul(s, 1103515245) + 12345) >>> 0;
		return (s >>> 8) % n;
	};
	for (let step = 0; step < STEPS; step++) {
		const floor = rand(FLOORS);
		const ids = live[floor] as number[];
		// Bias toward growth until near CAP, so the table fills and long probe chains form.
		const grow = ids.length < CAP - 1 && (ids.length === 0 || rand(10) < 6);
		if (grow) {
			const slot = storage.alloc(floor);
			const id = storage.ids[slot] ?? 0;
			truth.set(id, { floor, slot });
			ids.push(id);
		} else {
			const at = rand(ids.length);
			const id = ids[at] ?? 0;
			ids[at] = ids[ids.length - 1] ?? 0;
			ids.pop();
			const entry = truth.get(id);
			if (entry) storage.release(floor, entry.slot);
			truth.delete(id);
		}
	}
	let issued = 0;
	for (let floor = 0; floor < FLOORS; floor++) {
		const top = storage.counters[floor] ?? 0;
		for (let counter = 1; counter <= top; counter++) {
			const id = floor * (1 << 25) + counter;
			const entry = truth.get(id);
			expect(storage.slotOf(floor, id as EntityId)).toBe(
				entry ? entry.slot : NONE,
			);
			expect(storage.slotOf(1 - floor, id as EntityId)).toBe(NONE);
			issued++;
		}
	}
	expect(issued).toBeGreaterThan(STEPS / 2);
});

// Ids whose home is the table's last bucket probe past the end and wrap to bucket 0.
test("deleting from a run that wraps the table end keeps the rest findable", () => {
	const storage = new Storage(1, 0);
	const lastBucket = INDEX_SIZE - 1;
	const shift = Math.clz32(lastBucket);
	const home = (id: number) => Math.imul(id, 0x9e3779b1) >>> shift;
	const wrapping: number[] = [];
	for (let serial = 1; wrapping.length < 3; serial++)
		if (home(serial) === lastBucket) wrapping.push(serial);
	const last = wrapping[2] ?? 0;
	// Ids are issued in order: every other id is freed at once, so only the three stay indexed.
	const slots = new Map<number, Slot>();
	for (let serial = 1; serial <= last; serial++) {
		const slot = storage.alloc(0);
		const id = storage.ids[slot] ?? 0;
		if (wrapping.includes(id)) slots.set(id, slot);
		else storage.release(0, slot);
	}
	storage.release(0, slots.get(wrapping[0] ?? 0) as Slot);
	for (const id of wrapping.slice(1))
		expect(storage.slotOf(0, id as EntityId)).toBe(slots.get(id) as Slot);
	expect(storage.slotOf(0, (wrapping[0] ?? 0) as EntityId)).toBe(NONE);
});
