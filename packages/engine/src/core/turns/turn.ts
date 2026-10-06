import { MAX_ALTERNATES, MAX_TICK, TICKS_PER_TURN } from "../config";
import { type Cell, type EntityId, NO_CELL, NONE, type Slot } from "../ecs/ids";
import { PLAYER } from "../ecs/storage";
import {
	type ActionEntry,
	type Alarm,
	type Buffer,
	type Engine,
	FLOOR_STAGE,
	type Hook,
	KIND_CODE,
	NO_ACTION,
	NO_FLOOR,
	type TickHook,
} from "../engine";
import { applyHarm } from "../health/harm";
import { applyDeferred } from "../lifecycle/lifecycle";
import {
	ALTERNATE,
	FAIL,
	type ProposeFn,
	type TargetKind,
	type TargetOf,
} from "../module/api";
import { depart, ingest } from "../travel/travel";
import { validTarget } from "./target";

export function runFloor(e: Engine, floor: number): Slot {
	const audit = e.audit;
	audit?.startFloor(floor);
	if (e.stage[floor] === FLOOR_STAGE.waiting) beginFloor(e, floor);
	const due =
		e.stage[floor] === FLOOR_STAGE.acting ? runActors(e, floor) : NONE;
	audit?.endFloor(floor);
	return due;
}

export function beginFloor(e: Engine, floor: number): void {
	const start = e.round * TICKS_PER_TURN;
	e.now[floor] = start;
	e.events.startTurn(floor);
	ingest(e, floor, start, start + TICKS_PER_TURN);
	e.scheduler.open(floor, start + TICKS_PER_TURN);

	const tickCtx = e.tickCtx;
	tickCtx.setFloor(floor);
	const audit = e.audit;
	const from = floor * e.grid.stride;
	const to = from + e.grid.cells;
	for (let i = 0; i < e.ticks.length; i++) {
		const tick = e.ticks[i] as TickHook;
		const buffers = tick.buffers;
		for (let b = 0; b < buffers.length; b++) {
			const { current, previous } = buffers[b] as Buffer;
			previous.set(current.subarray(from, to), from);
		}
		tickCtx.setModule(tick.moduleKey);
		audit?.before(floor, tick.moduleKey, true);
		tick.run(tickCtx);
		audit?.after();
		applyHarm(e, floor);
		applyDeferred(e, floor);
	}
	e.stage[floor] = FLOOR_STAGE.acting;
}

export function runActors(e: Engine, floor: number): Slot {
	const end = (e.round + 1) * TICKS_PER_TURN;
	const scheduler = e.scheduler;
	const { ids, masks, maskWords } = e.storage;
	while (scheduler.size(floor) > 0 && scheduler.topTime(floor) < end) {
		const slot = scheduler.top(floor);
		const time = scheduler.nextAt[slot] ?? 0;
		e.now[floor] = time;
		if (((masks[slot * maskWords] ?? 0) & PLAYER) !== 0) return slot;
		const id = (ids[slot] ?? 0) as EntityId;
		finishTurn(e, floor, slot, id, time, decide(e, floor, slot, id));
	}
	e.now[floor] = end;
	e.stage[floor] = FLOOR_STAGE.done;
	return NONE;
}

// Harm, kills and spawns land before the actor is rescheduled, and before it leaves by stairs.
export function finishTurn(
	e: Engine,
	floor: number,
	slot: Slot,
	id: EntityId,
	time: number,
	cost: number,
): void {
	applyHarm(e, floor);
	applyDeferred(e, floor);
	const ids = e.storage.ids;
	if (e.leaveFloor !== NO_FLOOR) {
		if (ids[slot] === id) depart(e, floor, slot, time);
		e.leaveFloor = NO_FLOOR;
	}
	if (ids[slot] !== id) return;
	if (time + cost > MAX_TICK)
		throw new Error(`time ${time + cost} exceeds ${MAX_TICK}`);
	e.scheduler.delay(floor, slot, time + cost);
}

// Between two full decisions an actor repeats its cached one; any doubt about it decides afresh.
function decide(e: Engine, floor: number, slot: Slot, id: EntityId): number {
	const period = e.period[floor] ?? 0;
	const key = e.intentKey[slot] ?? 0;
	if (
		period > 1 &&
		key !== 0 &&
		(e.round + id) % period !== 0 &&
		!alarmed(e, floor, slot)
	) {
		const action = e.actionByKey.get(key);
		if (action !== undefined) {
			const target = e.intentTarget[slot] ?? 0;
			const { kind } = e.actions[action] as ActionEntry;
			if (validTarget(kind, target, e.grid.cells, e.storage.floors)) {
				const cost = execute(e, floor, slot, action, target);
				if (!e.failed) return cost;
			}
		}
		e.intentKey[slot] = 0;
		e.intentTarget[slot] = 0;
	}
	return act(e, floor, slot);
}

function alarmed(e: Engine, floor: number, slot: Slot): boolean {
	const alarms = e.alarms;
	if (alarms.length === 0) return false;
	const { masks, maskWords } = e.storage;
	const row = slot * maskWords;
	const at = floor * e.grid.stride + (e.grid.cellOf[slot] ?? 0);
	for (let i = 0; i < alarms.length; i++) {
		const alarm = alarms[i] as Alarm;
		const word = alarm.requiresWord;
		const bits = alarm.requiresBits;
		if (
			word < 0
				? !alarm.requires.has(slot)
				: ((masks[row + word] ?? 0) & bits) !== bits
		)
			continue;
		if ((alarm.field[at] ?? 0) !== 0) return true;
	}
	return false;
}

export function act(e: Engine, floor: number, slot: Slot): number {
	e.perception.reset(floor, slot);
	const out = e.candidates;
	out.begin(e.intentKey[slot] ?? 0, e.intentTarget[slot] ?? 0);
	const ctx = e.proposeCtx;
	ctx.setFloor(floor);
	const audit = e.audit;
	for (let i = 0; i < e.proposers.length; i++) {
		const proposer = e.proposers[i] as Hook<ProposeFn>;
		ctx.setModule(proposer.moduleKey);
		audit?.before(floor, proposer.moduleKey, false);
		proposer.run(ctx, slot, e.perception, out);
		audit?.after();
	}
	const best = out.count === 0 ? -1 : out.best();
	const action = best < 0 ? e.idleIndex : out.actionAt(best);
	const target = best < 0 ? 0 : out.targetAt(best);
	const entry = e.actions[action] as ActionEntry;
	e.intentKey[slot] = entry.key;
	e.intentTarget[slot] = target;
	const cost = execute(e, floor, slot, action, target);
	// A failed choice must not win the next tie through inertia.
	if (e.failed) {
		e.intentKey[slot] = 0;
		e.intentTarget[slot] = 0;
	}
	return cost;
}

export function execute(
	e: Engine,
	floor: number,
	slot: Slot,
	first: number,
	firstTarget: number,
): number {
	const ctx = e.actionCtx;
	ctx.setFloor(floor);
	const audit = e.audit;
	e.failed = false;
	// Lazy: an action that never reads perception never fills it.
	const perception = e.perception;
	perception.reset(floor, slot);
	const { masks, maskWords } = e.storage;
	const row = slot * maskWords;
	let action = first;
	let target = firstTarget;
	for (let depth = 0; ; depth++) {
		const entry = e.actions[action] as ActionEntry;
		const word = entry.requiresWord;
		const bits = entry.requiresBits;
		if (
			word < 0
				? !entry.requires.has(slot)
				: ((masks[row + word] ?? 0) & bits) !== bits
		) {
			e.failed = true;
			return TICKS_PER_TURN;
		}
		ctx.setModule(entry.moduleKey);
		e.alternate = NO_ACTION;
		const decoded = entry.kind === KIND_CODE.none ? null : target;
		audit?.before(floor, entry.moduleKey, true);
		const result = entry.run(
			ctx,
			slot,
			decoded as TargetOf[TargetKind],
			perception,
		);
		audit?.after();
		if (result === FAIL) {
			e.failed = true;
			return TICKS_PER_TURN;
		}
		if (result !== ALTERNATE) {
			if (!Number.isInteger(result) || result < 1)
				throw new Error(`action cost ${result} is not an integer >= 1`);
			return result;
		}
		if (e.alternate === NO_ACTION)
			throw new Error("ALTERNATE returned without ctx.instead");
		if (depth === MAX_ALTERNATES)
			throw new Error(`more than ${MAX_ALTERNATES} alternates`);
		action = e.alternate;
		target = e.alternateTarget;
	}
}

export function step(e: Engine, actor: Slot, cell: Cell): number {
	if (cell === NO_CELL) return FAIL;
	const grid = e.grid;
	if (cell < 0 || cell >= grid.cells)
		throw new Error(`cell ${cell} is outside the floor`);
	const dx = Math.abs((cell % grid.width) - (grid.x[actor] ?? 0));
	const dy = Math.abs(((cell / grid.width) | 0) - (grid.y[actor] ?? 0));
	if ((dx > dy ? dx : dy) !== 1) return FAIL;
	const floor = e.actionCtx.floor;
	if (grid.holdsOtherActor(floor, cell, actor)) return FAIL;
	grid.move(floor, actor, cell);
	return TICKS_PER_TURN;
}
