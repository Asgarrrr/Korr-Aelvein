import { INERTIA, MAX_CANDIDATES, SCORE_MAX } from "../config";
import type { ActionEntry } from "../engine";
import type {
	ActionRef,
	Candidates,
	TargetKind,
	TargetOf,
} from "../module/api";
import { validTarget } from "../turns/target";

const SCORE_BITS = 15;
if (SCORE_MAX + INERTIA >= 1 << SCORE_BITS)
	throw new Error(`SCORE_MAX + INERTIA must stay below 2^${SCORE_BITS}`);

export function targetValue(target: number | null): number {
	if (target === null) return 0;
	if (!Number.isInteger(target))
		throw new Error(`target ${target} is not an integer`);
	return target;
}

export class CandidateBuffer implements Candidates {
	#count = 0;
	readonly #action = new Int32Array(MAX_CANDIDATES);
	readonly #target = new Int32Array(MAX_CANDIDATES);
	readonly #key = new Uint32Array(MAX_CANDIDATES);
	readonly #kind = new Int8Array(MAX_CANDIDATES);
	readonly #score = new Int32Array(MAX_CANDIDATES);
	#intentKey = 0;
	#intentTarget = 0;
	readonly #actions: readonly ActionEntry[];
	readonly #cells: number;
	readonly #floors: number;

	constructor(actions: readonly ActionEntry[], cells: number, floors: number) {
		this.#actions = actions;
		this.#cells = cells;
		this.#floors = floors;
	}

	get count(): number {
		return this.#count;
	}

	actionAt(i: number): number {
		return this.#action[i] ?? 0;
	}

	targetAt(i: number): number {
		return this.#target[i] ?? 0;
	}

	begin(key: number, target: number): void {
		this.#count = 0;
		this.#intentKey = key;
		this.#intentTarget = target;
	}

	push<K extends TargetKind>(
		action: ActionRef<K>,
		target: TargetOf[K],
		score: number,
	): void {
		if (!Number.isInteger(score))
			throw new Error(`score ${score} is not an integer`);
		const i = this.#count;
		if (i === MAX_CANDIDATES)
			throw new Error(`more than ${MAX_CANDIDATES} candidates`);
		const entry = this.#actions[action.index] as ActionEntry;
		const value = targetValue(target);
		if (!validTarget(entry.kind, value, this.#cells, this.#floors))
			throw new Error(`${entry.name} cannot target ${value}`);
		this.#target[i] = value;
		this.#action[i] = action.index;
		this.#key[i] = entry.key;
		this.#kind[i] = entry.kind;
		const clamped = score < 0 ? 0 : score > SCORE_MAX ? SCORE_MAX : score;
		// After the clamp, so a score never exceeds SCORE_MAX + INERTIA.
		const kept =
			(entry.key | 0) === this.#intentKey && value === this.#intentTarget;
		this.#score[i] = kept ? clamped + INERTIA : clamped;
		this.#count = i + 1;
	}

	// Ties never fall to registry order: adding or reordering modules must not change a decision.
	best(): number {
		const key = this.#key;
		const kind = this.#kind;
		const target = this.#target;
		const score = this.#score;
		let best = 0;
		for (let i = 1; i < this.#count; i++) {
			const ds = (score[i] ?? 0) - (score[best] ?? 0);
			if (ds < 0) continue;
			if (ds === 0) {
				const dk = (key[i] ?? 0) - (key[best] ?? 0);
				if (dk > 0) continue;
				if (dk === 0) {
					const dt = (kind[i] ?? 0) - (kind[best] ?? 0);
					if (dt > 0) continue;
					if (dt === 0 && (target[i] ?? 0) >= (target[best] ?? 0)) continue;
				}
			}
			best = i;
		}
		return best;
	}
}

Object.freeze(CandidateBuffer.prototype);
