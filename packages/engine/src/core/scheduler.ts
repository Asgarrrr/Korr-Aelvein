import { CAP } from "./config";
import type { Slot } from "./ids";
import { ACTOR, type Storage } from "./storage";

// heapPos is derived state outside the hashed columns; it holds index + 1 so 0 means absent.
export class Scheduler {
	readonly nextAt: Int32Array;
	private readonly heapPos: Int32Array;
	private readonly ids: Int32Array;
	private readonly heap: Int32Array;
	private readonly sizes: Int32Array;

	constructor(private readonly storage: Storage) {
		this.nextAt = storage.column("i32") as Int32Array;
		this.heapPos = new Int32Array(storage.floors * CAP);
		this.ids = storage.ids;
		this.heap = new Int32Array(storage.floors * CAP);
		this.sizes = new Int32Array(storage.floors);
	}

	size(floor: number): number {
		return this.sizes[floor] ?? 0;
	}

	topTime(floor: number): number {
		return this.nextAt[this.heap[floor * CAP] ?? 0] ?? 0;
	}

	push(floor: number, slot: Slot): void {
		const size = this.size(floor);
		this.sizes[floor] = size + 1;
		this.up(floor * CAP, size, slot);
	}

	top(floor: number): Slot {
		return (this.heap[floor * CAP] ?? 0) as Slot;
	}

	// The key only grows, so sifting down from the current position restores the heap.
	delay(floor: number, slot: Slot, at: number): void {
		this.nextAt[slot] = at;
		this.down(
			floor * CAP,
			this.size(floor),
			(this.heapPos[slot] ?? 0) - 1,
			slot,
		);
	}

	remove(floor: number, slot: Slot): void {
		const index = (this.heapPos[slot] ?? 0) - 1;
		if (index >= 0) this.removeAt(floor, index);
	}

	// Keys (nextAt, EntityId) are unique, so the pop order depends on the key set, never on the heap layout.
	rebuild(floor: number): void {
		const { masks, maskWords, highWater } = this.storage;
		const base = floor * CAP;
		const end = base + (highWater[floor] ?? 0);
		let n = 0;
		for (let s = base; s < end; s++)
			if (((masks[s * maskWords] ?? 0) & ACTOR) !== 0) this.place(base, n++, s);
		this.sizes[floor] = n;
		heapify(this.heap, this.heapPos, this.nextAt, this.ids, base, n);
	}

	private removeAt(floor: number, index: number): void {
		const base = floor * CAP;
		const last = this.size(floor) - 1;
		this.sizes[floor] = last;
		this.heapPos[this.heap[base + index] ?? 0] = 0;
		if (index === last) return;
		const moved = this.heap[base + last] ?? 0;
		if (
			index > 0 &&
			this.before(moved, this.heap[base + ((index - 1) >> 1)] ?? 0)
		)
			this.up(base, index, moved);
		else this.down(base, last, index, moved);
	}

	private before(a: number, b: number): boolean {
		const ta = this.nextAt[a] ?? 0;
		const tb = this.nextAt[b] ?? 0;
		return ta < tb || (ta === tb && (this.ids[a] ?? 0) < (this.ids[b] ?? 0));
	}

	private place(base: number, index: number, slot: number): void {
		this.heap[base + index] = slot;
		this.heapPos[slot] = index + 1;
	}

	private up(base: number, start: number, slot: number): void {
		let index = start;
		while (index > 0) {
			const parentIndex = (index - 1) >> 1;
			const parent = this.heap[base + parentIndex] ?? 0;
			if (!this.before(slot, parent)) break;
			this.place(base, index, parent);
			index = parentIndex;
		}
		this.place(base, index, slot);
	}

	private down(base: number, size: number, start: number, slot: number): void {
		let index = start;
		for (;;) {
			const left = 2 * index + 1;
			if (left >= size) break;
			const right = left + 1;
			let child = left;
			let childSlot = this.heap[base + left] ?? 0;
			if (right < size) {
				const rightSlot = this.heap[base + right] ?? 0;
				if (this.before(rightSlot, childSlot)) {
					child = right;
					childSlot = rightSlot;
				}
			}
			if (!this.before(childSlot, slot)) break;
			this.place(base, index, childSlot);
			index = child;
		}
		this.place(base, index, slot);
	}
}

// Floyd's bottom-up build with the (nextAt, EntityId) order inlined: restore runs it on every
// actor of the floor, inside the restore budget.
function heapify(
	heap: Int32Array,
	heapPos: Int32Array,
	nextAt: Int32Array,
	ids: Int32Array,
	base: number,
	n: number,
): void {
	for (let start = (n >> 1) - 1; start >= 0; start--) {
		const slot = heap[base + start] ?? 0;
		const time = nextAt[slot] ?? 0;
		const id = ids[slot] ?? 0;
		let index = start;
		for (;;) {
			let child = 2 * index + 1;
			if (child >= n) break;
			let childSlot = heap[base + child] ?? 0;
			let childTime = nextAt[childSlot] ?? 0;
			if (child + 1 < n) {
				const right = heap[base + child + 1] ?? 0;
				const rightTime = nextAt[right] ?? 0;
				if (
					rightTime < childTime ||
					(rightTime === childTime && (ids[right] ?? 0) < (ids[childSlot] ?? 0))
				) {
					child++;
					childSlot = right;
					childTime = rightTime;
				}
			}
			if (
				!(
					childTime < time ||
					(childTime === time && (ids[childSlot] ?? 0) < id)
				)
			)
				break;
			heap[base + index] = childSlot;
			heapPos[childSlot] = index + 1;
			index = child;
		}
		heap[base + index] = slot;
		heapPos[slot] = index + 1;
	}
}
