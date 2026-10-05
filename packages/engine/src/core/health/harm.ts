import { CAP } from "../config";
import { type EntityId, NONE } from "../ecs/ids";
import type { Engine } from "../engine";
import { kill } from "../lifecycle/lifecycle";

const LIMIT = 2 * CAP;

export class Harms {
	count = 0;
	readonly targets = new Int32Array(LIMIT);
	readonly causes = new Int32Array(LIMIT);
	readonly amounts = new Int32Array(LIMIT);
	readonly order = new Int32Array(LIMIT);

	push(target: EntityId, cause: EntityId, amount: number): void {
		const n = this.count;
		if (n === LIMIT) throw new Error(`more than ${LIMIT} pending harms`);
		this.targets[n] = target;
		this.causes[n] = cause;
		this.amounts[n] = amount;
		this.count = n + 1;
	}
}

// Sorted by (target, cause, amount): a target's harms sum, so only its lowest cause and the
// target order of the kills can show, and neither depends on the order modules harmed in.
export function applyHarm(e: Engine, floor: number): void {
	const harms = e.harms;
	const n = harms.count;
	if (n === 0) return;
	const { targets, causes, amounts } = harms;
	const order = harms.order.subarray(0, n);
	for (let i = 0; i < n; i++) order[i] = i;
	order.sort(
		(a, b) =>
			(targets[a] ?? 0) - (targets[b] ?? 0) ||
			(causes[a] ?? 0) - (causes[b] ?? 0) ||
			(amounts[a] ?? 0) - (amounts[b] ?? 0) ||
			a - b,
	);
	const { storage } = e;
	const { hp, word, bit } = e.vitality;
	const words = storage.maskWords;
	let i = 0;
	while (i < n) {
		const first = order[i] ?? 0;
		const target = (targets[first] ?? 0) as EntityId;
		let total = 0;
		for (; i < n && targets[order[i] ?? 0] === target; i++)
			total += amounts[order[i] ?? 0] ?? 0;
		const slot = storage.slotOf(floor, target);
		if (
			slot === NONE ||
			((storage.masks[slot * words + word] ?? 0) & bit) === 0
		)
			continue;
		const left = (hp[slot] ?? 0) - total;
		if (left > 0) hp[slot] = left;
		else kill(e, floor, target, (causes[first] ?? 0) as EntityId);
	}
	harms.count = 0;
}
