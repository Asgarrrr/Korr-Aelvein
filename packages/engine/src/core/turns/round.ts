import { LOD_PERIODS, TICKS_PER_TURN } from "../config";
import { type EntityId, NONE, type Slot } from "../ecs/ids";
import { PLAYER } from "../ecs/storage";
import { type Engine, FLOOR_STAGE } from "../engine";
import { execute, finishTurn, runFloor } from "./turn";

const LAST_TIER = LOD_PERIODS.length - 1;

// With no player anywhere every floor decides every turn: nobody is near enough to tell a
// cheaper floor apart, and a world without players keeps the plain arbitration of every turn.
export function startRound(e: Engine): void {
	const { players, period, inbox } = e;
	const floors = e.storage.floors;
	for (let f = 0; f < floors; f++) {
		let nearest = -1;
		for (let g = 0; g < floors; g++) {
			if ((players[g] ?? 0) + inbox.players(g) === 0) continue;
			const d = f > g ? f - g : g - f;
			if (nearest < 0 || d < nearest) nearest = d;
		}
		const tier = nearest < 0 ? 0 : nearest > LAST_TIER ? LAST_TIER : nearest;
		period[f] = LOD_PERIODS[tier] ?? 1;
	}
}

// Runs every floor until its round ends or a player on it is due. Returns the due players, by
// floor; when none is left the round is over everywhere and the next call starts the next one.
export function advance(e: Engine): EntityId[] {
	const { stage, storage, scheduler } = e;
	const floors = storage.floors;
	if (stage.every((s) => s === FLOOR_STAGE.waiting)) startRound(e);
	for (const f of e.floorOrder) runFloor(e, f);
	const due: EntityId[] = [];
	for (let f = 0; f < floors; f++)
		if (stage[f] !== FLOOR_STAGE.done)
			due.push((storage.ids[scheduler.top(f)] ?? 0) as EntityId);
	if (due.length > 0) return due;
	e.audit?.endRound();
	e.round++;
	stage.fill(FLOOR_STAGE.waiting);
	e.period.fill(0);
	return due;
}

export function playerTurn(
	e: Engine,
	floor: number,
	slot: Slot,
	action: number,
	target: number,
): void {
	const id = (e.storage.ids[slot] ?? 0) as EntityId;
	const time = e.scheduler.nextAt[slot] ?? 0;
	e.now[floor] = time;
	e.audit?.startFloor(floor);
	finishTurn(e, floor, slot, id, time, execute(e, floor, slot, action, target));
	e.audit?.endFloor(floor);
}

export function dueOn(e: Engine, floor: number): Slot {
	if (e.stage[floor] !== FLOOR_STAGE.acting) return NONE;
	const slot = e.scheduler.top(floor);
	const { masks, maskWords } = e.storage;
	const end = (e.round + 1) * TICKS_PER_TURN;
	const player = ((masks[slot * maskWords] ?? 0) & PLAYER) !== 0;
	return player && (e.scheduler.nextAt[slot] ?? end) < end ? slot : NONE;
}
