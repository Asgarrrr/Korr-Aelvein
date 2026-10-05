import { EVENT_CAP_PER_TURN } from "./config";
import type { EntityId } from "./ids";

export type EventVisitor = (
	type: number,
	cause: EntityId,
	a: number,
	b: number,
	time: number,
) => void;

const CAUSE = 1;
const A = 2;
const B = 3;
const TIME = 4;
const FIELDS = 5;
const FIRST_RING = 1024;
const EMPTY = new Int32Array(0);

// A floor's ring is allocated on its first recorded event and doubles up to one turn's cap.
// Once at the cap, events left undrained from earlier turns are overwritten oldest first.
export class EventLog {
	readonly enabled: Uint8Array;
	private readonly rings: Int32Array[];
	private readonly head: Int32Array;
	private readonly size: Int32Array;
	private readonly emitted: Int32Array;

	constructor(floors: number, enabled: boolean) {
		this.enabled = new Uint8Array(floors).fill(enabled ? 1 : 0);
		this.rings = Array.from({ length: floors }, () => EMPTY);
		this.head = new Int32Array(floors);
		this.size = new Int32Array(floors);
		this.emitted = new Int32Array(floors);
	}

	startTurn(floor: number): void {
		this.emitted[floor] = 0;
	}

	// Counted before the switch is read, so a disabled floor throws at the same point.
	emit(
		floor: number,
		type: number,
		cause: EntityId,
		a: number,
		b: number,
		time: number,
	): void {
		const n = (this.emitted[floor] ?? 0) + 1;
		if (n > EVENT_CAP_PER_TURN)
			throw new Error(
				`floor ${floor} emitted more than ${EVENT_CAP_PER_TURN} events this turn`,
			);
		this.emitted[floor] = n;
		if (this.enabled[floor] === 0) return;
		let ring = this.rings[floor] ?? EMPTY;
		const size = this.size[floor] ?? 0;
		if (size * FIELDS === ring.length && size < EVENT_CAP_PER_TURN)
			ring = this.grow(floor, ring);
		const head = this.head[floor] ?? 0;
		const capacity = ring.length / FIELDS;
		const at = ((head + size) & (capacity - 1)) * FIELDS;
		ring[at] = type;
		ring[at + CAUSE] = cause;
		ring[at + A] = a;
		ring[at + B] = b;
		ring[at + TIME] = time;
		if (size === capacity) this.head[floor] = (head + 1) & (capacity - 1);
		else this.size[floor] = size + 1;
	}

	drain(floor: number, visit: EventVisitor): void {
		const ring = this.rings[floor] ?? EMPTY;
		const wrap = ring.length / FIELDS - 1;
		for (let size = this.size[floor] ?? 0; size > 0; size--) {
			const head = this.head[floor] ?? 0;
			const at = head * FIELDS;
			this.head[floor] = (head + 1) & wrap;
			this.size[floor] = size - 1;
			visit(
				ring[at] ?? 0,
				(ring[at + CAUSE] ?? 0) as EntityId,
				ring[at + A] ?? 0,
				ring[at + B] ?? 0,
				ring[at + TIME] ?? 0,
			);
		}
	}

	// Only called on a full ring: unrolling from the head keeps FIFO order.
	private grow(floor: number, ring: Int32Array): Int32Array {
		const capacity = Math.max(FIRST_RING, (2 * ring.length) / FIELDS);
		const next = new Int32Array(capacity * FIELDS);
		const start = (this.head[floor] ?? 0) * FIELDS;
		next.set(ring.subarray(start));
		next.set(ring.subarray(0, start), ring.length - start);
		this.rings[floor] = next;
		this.head[floor] = 0;
		return next;
	}
}
