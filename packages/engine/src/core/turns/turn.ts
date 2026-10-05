import {
	ALTERNATE,
	FAIL,
	type ProposeFn,
	type TargetKind,
	type TargetOf,
} from "../api";
import { MAX_ALTERNATES, MAX_TICK, TICKS_PER_TURN } from "../config";
import { type Cell, type EntityId, NO_CELL, type Slot } from "../ecs/ids";
import {
	type ActionEntry,
	type Buffer,
	type Engine,
	type Hook,
	KIND_CODE,
	NO_ACTION,
	type TickHook,
} from "../engine";
import { applyHarm } from "../health/harm";
import { applyDeferred } from "../lifecycle/lifecycle";

export function runFloor(e: Engine, floor: number): void {
	const start = e.round * TICKS_PER_TURN;
	const end = start + TICKS_PER_TURN;
	e.now[floor] = start;
	e.events.startTurn(floor);

	const tickCtx = e.tickCtx;
	tickCtx.setFloor(floor);
	const audit = e.audit;
	audit?.startFloor(floor);
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

	const scheduler = e.scheduler;
	const ids = e.storage.ids;
	while (scheduler.size(floor) > 0 && scheduler.topTime(floor) < end) {
		const slot = scheduler.top(floor);
		const time = scheduler.nextAt[slot] ?? 0;
		const id = (ids[slot] ?? 0) as EntityId;
		e.now[floor] = time;
		const cost = act(e, floor, slot);
		applyHarm(e, floor);
		applyDeferred(e, floor);
		if (ids[slot] !== id) continue;
		if (time + cost > MAX_TICK)
			throw new Error(`time ${time + cost} exceeds ${MAX_TICK}`);
		scheduler.delay(floor, slot, time + cost);
	}
	e.now[floor] = end;
	audit?.endFloor(floor);
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
	let action = first;
	let target = firstTarget;
	for (let depth = 0; ; depth++) {
		const entry = e.actions[action] as ActionEntry;
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
