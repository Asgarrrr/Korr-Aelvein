import { expect, test } from "bun:test";
import type { Slot } from "../../src/core/api";
import { Scheduler } from "../../src/core/scheduler";
import { Storage } from "../../src/core/storage";

const SIZE = 64;

// Different push and removal permutations reach both sift directions after a removal.
for (const pushStride of [3, 37])
	for (const removeStride of [7, 11])
		test(`removals keep the heap ordered (push ${pushStride}, remove ${removeStride})`, () => {
			const storage = new Storage(1, 0);
			const scheduler = new Scheduler(storage);
			const slots: Slot[] = [];
			for (let i = 0; i < SIZE; i++) {
				const slot = storage.alloc(0);
				slots.push(slot);
				scheduler.nextAt[slot] = ((i * pushStride) % SIZE) * 10;
				scheduler.push(0, slot);
			}
			const removed = new Set<number>();
			for (let i = 0; i < SIZE; i += 3) {
				const slot = slots[(i * removeStride) % SIZE] as Slot;
				if (removed.has(slot)) continue;
				removed.add(slot);
				scheduler.remove(0, slot);
			}
			const drained: number[] = [];
			while (scheduler.size(0) > 0) {
				const top = scheduler.top(0);
				drained.push(scheduler.nextAt[top] ?? 0);
				scheduler.remove(0, top);
			}
			const expected = slots
				.filter((s) => !removed.has(s))
				.map((s) => scheduler.nextAt[s] ?? 0)
				.sort((a, b) => a - b);
			expect(drained).toEqual(expected);
		});
