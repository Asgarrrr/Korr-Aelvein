import { CAP } from "./config";
import type { Cell, EntityId } from "./ids";
import type { SpeciesShape } from "./species";

const LIMIT = 2 * CAP;

// Applied in (cause, key, emission) order, so the result never depends on row iteration order.
class DeferredList {
	count = 0;
	readonly order = new Int32Array(LIMIT);
	private readonly causes = new Int32Array(LIMIT);
	private readonly keys = new Int32Array(LIMIT);
	private readonly scratch = new Int32Array(LIMIT);

	constructor(private readonly what: string) {}

	protected add(cause: EntityId, key: number): number {
		const n = this.count;
		if (n === LIMIT)
			throw new Error(`more than ${LIMIT} deferred ${this.what}`);
		this.causes[n] = cause;
		this.keys[n] = key;
		this.count = n + 1;
		return n;
	}

	sort(): void {
		const n = this.count;
		let src = this.order;
		let dst = this.scratch;
		for (let i = 0; i < n; i++) src[i] = i;
		if (n < 2) return;
		for (let width = 1; width < n; width *= 2) {
			for (let lo = 0; lo < n; lo += 2 * width) {
				this.merge(
					src,
					dst,
					lo,
					Math.min(lo + width, n),
					Math.min(lo + 2 * width, n),
				);
			}
			const swap = src;
			src = dst;
			dst = swap;
		}
		if (src !== this.order)
			for (let i = 0; i < n; i++) this.order[i] = src[i] ?? 0;
	}

	private merge(
		src: Int32Array,
		dst: Int32Array,
		lo: number,
		mid: number,
		hi: number,
	): void {
		let i = lo;
		let j = mid;
		for (let k = lo; k < hi; k++) {
			const left = src[i] ?? 0;
			const right = src[j] ?? 0;
			if (i < mid && (j >= hi || !this.before(right, left))) {
				dst[k] = left;
				i++;
			} else {
				dst[k] = right;
				j++;
			}
		}
	}

	private before(a: number, b: number): boolean {
		const ca = this.causes[a] ?? 0;
		const cb = this.causes[b] ?? 0;
		return ca < cb || (ca === cb && (this.keys[a] ?? 0) < (this.keys[b] ?? 0));
	}
}

export class DeferredKills extends DeferredList {
	readonly ids = new Int32Array(LIMIT);

	constructor() {
		super("kills");
	}

	push(id: EntityId, cause: EntityId): void {
		this.ids[this.add(cause, id)] = id;
	}
}

export class DeferredSpawns extends DeferredList {
	readonly species: (SpeciesShape | undefined)[] = new Array(LIMIT);
	readonly xs = new Int32Array(LIMIT);
	readonly ys = new Int32Array(LIMIT);

	constructor() {
		super("spawns");
	}

	push(
		species: SpeciesShape,
		x: number,
		y: number,
		cell: Cell,
		cause: EntityId,
	): void {
		const n = this.add(cause, cell);
		this.species[n] = species;
		this.xs[n] = x;
		this.ys[n] = y;
	}
}
