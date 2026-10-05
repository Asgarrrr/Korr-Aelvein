import { FAIL } from "../api";
import { MAX_TICK, STAIR_TIME, TICKS_PER_TURN } from "../config";
import { type Cell, type EntityId, NO_CELL, NONE, type Slot } from "../ecs/ids";
import { type Engine, FLOOR_STAGE, NO_FLOOR } from "../engine";
import { attach, detach } from "../lifecycle/membership";
import { mix } from "../random/rng";

if (STAIR_TIME < TICKS_PER_TURN)
	throw new Error(
		"STAIR_TIME must be at least one turn: arrivals land in a later round",
	);

const hasLink = (e: Engine, slot: Slot) =>
	((e.storage.masks[slot * e.storage.maskWords + e.link.word] ?? 0) &
		e.link.bit) !==
	0;

// core.travel: the departure itself waits until the turn's harm and kills are applied.
export function travel(e: Engine, actor: Slot, stairs: EntityId): number {
	const floor = e.actionCtx.floor;
	const slot = e.storage.slotOf(floor, stairs);
	if (slot === NONE || !hasLink(e, slot)) return FAIL;
	const { x, y } = e.grid;
	const dx = Math.abs((x[slot] ?? 0) - (x[actor] ?? 0));
	const dy = Math.abs((y[slot] ?? 0) - (y[actor] ?? 0));
	if ((dx > dy ? dx : dy) > 1) return FAIL;
	e.leaveFloor = e.link.floor[slot] ?? 0;
	e.leaveX = e.link.x[slot] ?? 0;
	e.leaveY = e.link.y[slot] ?? 0;
	return TICKS_PER_TURN;
}

export function depart(
	e: Engine,
	floor: number,
	slot: Slot,
	time: number,
): void {
	const to = e.leaveFloor;
	e.leaveFloor = NO_FLOOR;
	const arrival = time + STAIR_TIME;
	if (arrival > MAX_TICK)
		throw new Error(`time ${arrival} exceeds ${MAX_TICK}`);
	const round = e.round + (e.stage[to] === FLOOR_STAGE.waiting ? 0 : 1);
	if (arrival < round * TICKS_PER_TURN)
		throw new Error(
			`arrival at ${arrival} on floor ${to}, which has passed ${round * TICKS_PER_TURN}`,
		);
	const id = (e.storage.ids[slot] ?? 0) as EntityId;
	e.inbox.post(to, arrival, id, e.leaveX, e.leaveY, slot);
	// Summed, not chained: posts from other floors land in an order the floor order decides.
	const passage = mix(mix(mix(id, time), floor), to);
	e.traffic[floor] = ((e.traffic[floor] ?? 0) + passage) | 0;
	e.traffic[to] = ((e.traffic[to] ?? 0) + passage) | 0;
	detach(e, floor, slot);
	e.emit(floor, e.departed, id, id, to);
}

// Lands every entry due before `end`; one with no free cell or slot waits for a later round.
export function ingest(
	e: Engine,
	floor: number,
	start: number,
	end: number,
): void {
	const { inbox } = e;
	if (inbox.count(floor) === 0) return;
	// Arrivals only fill the floor: once one finds no cell or slot, none after it will.
	let blocked = false;
	inbox.keep(floor, (n) => {
		const time = inbox.time(floor, n);
		if (time >= end || blocked) return true;
		const cell = e.storage.full(floor)
			? NO_CELL
			: freeCell(e, floor, inbox.x(floor, n), inbox.y(floor, n));
		if (cell === NO_CELL) {
			blocked = true;
			return true;
		}
		arrive(e, floor, n, cell, time > start ? time : start);
		return false;
	});
	e.now[floor] = start;
}

function arrive(
	e: Engine,
	floor: number,
	n: number,
	cell: Cell,
	time: number,
): void {
	const { storage, inbox, grid } = e;
	const id = inbox.id(floor, n);
	const slot = storage.adopt(floor, id);
	inbox.land(floor, n, slot);
	attach(e, floor, slot, cell % grid.width, (cell / grid.width) | 0, time);
	e.now[floor] = time;
	e.emit(floor, e.arrived, id, id, 0);
}

// The link cell, else the first cell free of actors in perception order: Chebyshev ring, then scan order.
function freeCell(e: Engine, floor: number, cx: number, cy: number): Cell {
	const grid = e.grid;
	const { width, height } = grid;
	const reach = width > height ? width : height;
	for (let d = 0; d <= reach; d++) {
		for (let y = cy - d; y <= cy + d; y++) {
			if (y < 0 || y >= height) continue;
			const edge = y === cy - d || y === cy + d;
			const stride = edge ? 1 : 2 * d;
			for (let x = cx - d; x <= cx + d; x += stride) {
				if (x < 0 || x >= width) continue;
				const cell = (y * width + x) as Cell;
				if (!grid.holdsOtherActor(floor, cell, NONE)) return cell;
			}
		}
	}
	return NO_CELL;
}
