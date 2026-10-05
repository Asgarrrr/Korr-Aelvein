import {
	CAP,
	ID_FLOOR_STRIDE,
	MAX_FLOORS,
	MAX_TICK,
	TICKS_PER_TURN,
} from "../config";
import { NONE, type Slot } from "../ecs/ids";
import { ACTOR, type Storage } from "../ecs/storage";

// A key packs (time in round, id, slot in floor) into one exact double, so numeric order is the
// (nextAt, EntityId) order: 7 + 31 + 14 bits.
const ID_SPAN = MAX_FLOORS * ID_FLOOR_STRIDE;
// Run and later entries are (id, slot) pairs; the time is the slot's nextAt.
const FIELDS = 2;
const FIRST_SIZE = 64;
const NOTHING = Number.POSITIVE_INFINITY;
const FROM_RUN = 0;
const FROM_SOON = 1;

const grown = <A extends Float64Array | Int32Array>(
	array: A,
	need: number,
): A => {
	if (need <= array.length) return array;
	const bigger = new (array.constructor as new (n: number) => A)(
		Math.max(FIRST_SIZE, need + (need >> 1)),
	);
	bigger.set(array);
	return bigger;
};

// Most actors enter the next round in the order they left this one, so the sort is nearly
// free; a run far out of order falls back to the native sort.
function sortKeys(keys: Float64Array, n: number): void {
	let moves = 0;
	for (let i = 1; i < n; i++) {
		const key = keys[i] ?? 0;
		let j = i - 1;
		if ((keys[j] ?? 0) <= key) continue;
		while (j >= 0 && (keys[j] ?? 0) > key) {
			keys[j + 1] = keys[j] ?? 0;
			j--;
			if (++moves > n) {
				keys[j + 1] = key;
				keys.subarray(0, n).sort();
				return;
			}
		}
		keys[j + 1] = key;
	}
}

// This round's actors are a run sorted once (a turn is a cursor step, not a heap sift), plus a
// heap of re-entries; later rounds wait unsorted. A removed actor's entry is skipped when reached.
export class Scheduler {
	readonly nextAt: Int32Array;
	private readonly ids: Int32Array;
	private readonly queued: Uint8Array;
	private readonly counts: Int32Array;
	private readonly horizon: Int32Array;
	private readonly runs: Int32Array[];
	private readonly runSizes: Int32Array;
	private readonly cursors: Int32Array;
	private keys = new Float64Array(0);
	private readonly soon: Float64Array[];
	private readonly soonSizes: Int32Array;
	private readonly later: Int32Array[];
	private readonly laterSizes: Int32Array;
	// The settled top of each floor and where it sits, valid while `settled` is set.
	private readonly settled: Uint8Array;
	private readonly topSlots: Int32Array;
	private readonly topTimes: Float64Array;
	private readonly topFrom: Uint8Array;

	constructor(private readonly storage: Storage) {
		const floors = storage.floors;
		this.nextAt = storage.column("i32") as Int32Array;
		this.ids = storage.ids;
		this.queued = new Uint8Array(floors * CAP);
		this.counts = new Int32Array(floors);
		this.horizon = new Int32Array(floors);
		this.runs = Array.from({ length: floors }, () => new Int32Array(0));
		this.runSizes = new Int32Array(floors);
		this.cursors = new Int32Array(floors);
		this.soon = Array.from({ length: floors }, () => new Float64Array(0));
		this.soonSizes = new Int32Array(floors);
		this.later = Array.from({ length: floors }, () => new Int32Array(0));
		this.laterSizes = new Int32Array(floors);
		this.settled = new Uint8Array(floors);
		this.topSlots = new Int32Array(floors);
		this.topTimes = new Float64Array(floors);
		this.topFrom = new Uint8Array(floors);
	}

	// Queued actors in every round.
	size(floor: number): number {
		return this.counts[floor] ?? 0;
	}

	// Infinity once nothing is due before the horizon.
	topTime(floor: number): number {
		if (this.settled[floor] !== 1) this.settle(floor);
		return this.topTimes[floor] ?? NOTHING;
	}

	top(floor: number): Slot {
		if (this.settled[floor] !== 1) this.settle(floor);
		return (this.topSlots[floor] ?? NONE) as Slot;
	}

	push(floor: number, slot: Slot): void {
		this.queued[slot] = 1;
		this.counts[floor] = (this.counts[floor] ?? 0) + 1;
		this.insert(floor, slot);
	}

	// Only the top is ever delayed: the actor whose turn just ended.
	delay(floor: number, slot: Slot, at: number): void {
		if (this.top(floor) !== slot)
			throw new Error(`slot ${slot} is delayed but it is not due`);
		this.consumeTop(floor);
		this.nextAt[slot] = at;
		this.insert(floor, slot);
	}

	remove(floor: number, slot: Slot): void {
		if (this.queued[slot] !== 1) return;
		if (this.top(floor) === slot) this.consumeTop(floor);
		this.queued[slot] = 0;
		this.counts[floor] = (this.counts[floor] ?? 0) - 1;
		this.settled[floor] = 0;
	}

	// Starts the round ending at `end`: its due actors become the sorted run.
	open(floor: number, end: number): void {
		if (end > MAX_TICK)
			throw new Error(`a round ending at ${end} would pass MAX_TICK`);
		if (this.topTime(floor) !== NOTHING)
			throw new Error(`floor ${floor} opened a round before its last ended`);
		this.horizon[floor] = end;
		this.settled[floor] = 0;
		this.soonSizes[floor] = 0;
		const base = end - TICKS_PER_TURN;
		const from = floor * CAP;
		const list = this.later[floor] as Int32Array;
		const entries = this.laterSizes[floor] ?? 0;
		const keys = grown(this.keys, entries);
		this.keys = keys;
		const { queued, ids, nextAt } = this;
		let kept = 0;
		let n = 0;
		for (let at = 0; at < entries * FIELDS; at += FIELDS) {
			const id = list[at] ?? 0;
			const slot = list[at + 1] ?? 0;
			if (queued[slot] !== 1 || ids[slot] !== id) continue;
			const time = nextAt[slot] ?? 0;
			if (time < end) {
				keys[n++] = ((time - base) * ID_SPAN + id) * CAP + (slot - from);
				continue;
			}
			list[kept * FIELDS] = id;
			list[kept * FIELDS + 1] = slot;
			kept++;
		}
		this.laterSizes[floor] = kept;
		sortKeys(keys, n);
		const run = grown(this.runs[floor] as Int32Array, n * FIELDS);
		this.runs[floor] = run;
		for (let i = 0; i < n; i++) {
			// Both spans are powers of two, so floor division is exact and far cheaper than %.
			const key = keys[i] ?? 0;
			const rest = Math.floor(key / CAP);
			const offset = Math.floor(rest / ID_SPAN);
			run[i * FIELDS] = rest - offset * ID_SPAN;
			run[i * FIELDS + 1] = from + key - rest * CAP;
		}
		this.runSizes[floor] = n;
		this.cursors[floor] = 0;
	}

	// Rebuilt from nextAt alone, so the turn order depends on the saved columns, never on layout.
	rebuild(floor: number, horizon: number): void {
		const { masks, maskWords, highWater } = this.storage;
		const { queued, nextAt, ids } = this;
		const base = floor * CAP;
		const end = base + (highWater[floor] ?? 0);
		queued.fill(0, base, base + CAP);
		const list = grown(this.later[floor] as Int32Array, (end - base) * FIELDS);
		this.later[floor] = list;
		let n = 0;
		let first = NOTHING;
		for (let s = base; s < end; s++) {
			if (((masks[s * maskWords] ?? 0) & ACTOR) === 0) continue;
			queued[s] = 1;
			const time = nextAt[s] ?? 0;
			if (time < first) first = time;
			list[n * FIELDS] = ids[s] ?? 0;
			list[n * FIELDS + 1] = s;
			n++;
		}
		this.counts[floor] = n;
		this.laterSizes[floor] = n;
		this.runSizes[floor] = 0;
		this.soonSizes[floor] = 0;
		this.settled[floor] = 0;
		this.horizon[floor] = horizon;
		// Restored between rounds, nothing is due before the horizon: the next open sorts them.
		if (first < horizon) this.open(floor, horizon);
	}

	// Finds the lowest entry due before the horizon, dropping those of removed actors.
	private settle(floor: number): void {
		const { queued, ids, nextAt } = this;
		const run = this.runs[floor] as Int32Array;
		const n = this.runSizes[floor] ?? 0;
		let c = this.cursors[floor] ?? 0;
		for (; c < n; c++) {
			const slot = run[c * FIELDS + 1] ?? 0;
			if (queued[slot] === 1 && ids[slot] === run[c * FIELDS]) break;
		}
		this.cursors[floor] = c;
		let slot: number = NONE;
		let time = NOTHING;
		let id = 0;
		let source = FROM_RUN;
		if (c < n) {
			id = run[c * FIELDS] ?? 0;
			slot = run[c * FIELDS + 1] ?? 0;
			time = nextAt[slot] ?? 0;
		}
		const heap = this.soon[floor] as Float64Array;
		const base = (this.horizon[floor] ?? 0) - TICKS_PER_TURN;
		while ((this.soonSizes[floor] ?? 0) > 0) {
			const key = heap[0] ?? 0;
			const rest = Math.floor(key / CAP);
			const offset = Math.floor(rest / ID_SPAN);
			const heldId = rest - offset * ID_SPAN;
			const heldSlot = floor * CAP + key - rest * CAP;
			if (queued[heldSlot] !== 1 || ids[heldSlot] !== heldId) {
				this.popSoon(floor);
				continue;
			}
			const heldTime = base + offset;
			if (heldTime < time || (heldTime === time && heldId < id)) {
				slot = heldSlot;
				time = heldTime;
				source = FROM_SOON;
			}
			break;
		}
		this.topSlots[floor] = slot;
		this.topTimes[floor] = time;
		this.topFrom[floor] = source;
		this.settled[floor] = 1;
	}

	private consumeTop(floor: number): void {
		if (this.topFrom[floor] === FROM_RUN)
			this.cursors[floor] = (this.cursors[floor] ?? 0) + 1;
		else this.popSoon(floor);
		this.settled[floor] = 0;
	}

	private insert(floor: number, slot: number): void {
		this.settled[floor] = 0;
		const time = this.nextAt[slot] ?? 0;
		const horizon = this.horizon[floor] ?? 0;
		if (time >= horizon) {
			const n = this.laterSizes[floor] ?? 0;
			const list = grown(this.later[floor] as Int32Array, (n + 1) * FIELDS);
			this.later[floor] = list;
			list[n * FIELDS] = this.ids[slot] ?? 0;
			list[n * FIELDS + 1] = slot;
			this.laterSizes[floor] = n + 1;
			return;
		}
		const base = horizon - TICKS_PER_TURN;
		if (time < base)
			throw new Error(`slot ${slot} scheduled at ${time}, before its round`);
		const key =
			((time - base) * ID_SPAN + (this.ids[slot] ?? 0)) * CAP +
			(slot - floor * CAP);
		const size = this.soonSizes[floor] ?? 0;
		const heap = grown(this.soon[floor] as Float64Array, size + 1);
		this.soon[floor] = heap;
		this.soonSizes[floor] = size + 1;
		let i = size;
		while (i > 0) {
			const parent = (i - 1) >> 1;
			const above = heap[parent] ?? 0;
			if (above <= key) break;
			heap[i] = above;
			i = parent;
		}
		heap[i] = key;
	}

	private popSoon(floor: number): void {
		const heap = this.soon[floor] as Float64Array;
		const size = (this.soonSizes[floor] ?? 0) - 1;
		this.soonSizes[floor] = size;
		const last = heap[size] ?? 0;
		let i = 0;
		for (;;) {
			let child = 2 * i + 1;
			if (child >= size) break;
			if (child + 1 < size && (heap[child + 1] ?? 0) < (heap[child] ?? 0))
				child++;
			if ((heap[child] ?? 0) >= last) break;
			heap[i] = heap[child] ?? 0;
			i = child;
		}
		heap[i] = last;
	}
}
