import type { ActionRef, Candidates, TargetKind, TargetOf } from "./api";
import { MAX_CANDIDATES, SCORE_MAX } from "./config";
import type { ActionEntry } from "./engine";

export function targetValue(target: number | null): number {
	if (target === null) return 0;
	if (!Number.isInteger(target))
		throw new Error(`target ${target} is not an integer`);
	return target;
}

export class CandidateBuffer implements Candidates {
	count = 0;
	readonly action = new Int32Array(MAX_CANDIDATES);
	readonly target = new Int32Array(MAX_CANDIDATES);
	private readonly key = new Uint32Array(MAX_CANDIDATES);
	private readonly kind = new Int8Array(MAX_CANDIDATES);
	private readonly score = new Int32Array(MAX_CANDIDATES);

	constructor(private readonly actions: readonly ActionEntry[]) {}

	push<K extends TargetKind>(
		action: ActionRef<K>,
		target: TargetOf[K],
		score: number,
	): void {
		if (!Number.isInteger(score))
			throw new Error(`score ${score} is not an integer`);
		const i = this.count;
		if (i === MAX_CANDIDATES)
			throw new Error(`more than ${MAX_CANDIDATES} candidates`);
		const entry = this.actions[action.index] as ActionEntry;
		this.target[i] = targetValue(target);
		this.action[i] = action.index;
		this.key[i] = entry.key;
		this.kind[i] = entry.kind;
		this.score[i] = score < 0 ? 0 : score > SCORE_MAX ? SCORE_MAX : score;
		this.count = i + 1;
	}

	// Ties never fall to registry order: adding or reordering modules must not change a decision.
	best(): number {
		const { key, kind, target, score } = this;
		let best = 0;
		for (let i = 1; i < this.count; i++) {
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
