import type { Slot } from "../ecs/ids";
import { ACTOR, PLAYER } from "../ecs/storage";
import type { Engine } from "../engine";

// Expects the row's mask written: it decides the schedule and the player tally.
export function attach(
	e: Engine,
	floor: number,
	slot: Slot,
	x: number,
	y: number,
	at: number,
): void {
	e.grid.insert(floor, slot, x, y);
	const mask = e.storage.masks[slot * e.storage.maskWords] ?? 0;
	if ((mask & ACTOR) !== 0) {
		e.scheduler.nextAt[slot] = at;
		e.scheduler.push(floor, slot);
	}
	if ((mask & PLAYER) !== 0) e.players[floor] = (e.players[floor] ?? 0) + 1;
}

// The tally reads the mask before release clears it.
export function detach(e: Engine, floor: number, slot: Slot): void {
	if (((e.storage.masks[slot * e.storage.maskWords] ?? 0) & PLAYER) !== 0)
		e.players[floor] = (e.players[floor] ?? 0) - 1;
	e.grid.remove(floor, slot);
	e.scheduler.remove(floor, slot);
	e.storage.release(floor, slot);
}
