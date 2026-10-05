import { MAX_TICK, TICKS_PER_TURN } from "../config";
import { type Cell, type EntityId, NO_CELL, NONE } from "../ecs/ids";
import type { Column } from "../ecs/schema";
import { PLAYER } from "../ecs/storage";
import type { Engine } from "../engine";
import { validLink } from "../travel/link";
import {
	type CompiledSpecies,
	compileSpecies,
	type SpeciesShape,
} from "./species";

const NO_CAUSE = 0 as EntityId;

// Compiled on every call: a direct spawn is setup work, and a cache would serve an edited object stale.
export function spawn(
	e: Engine,
	floor: number,
	species: SpeciesShape,
	x: number,
	y: number,
	at: number,
	player = false,
): EntityId {
	const cell = checkSpawn(e, floor, x, y);
	const compiled = compileSpecies(species, e.components, e.storage.maskWords);
	if (player && !compiled.actor) throw new Error("a player must be an actor");
	if (compiled.actor && e.grid.holdsOtherActor(floor, cell, NONE))
		throw new Error(`spawn at (${x}, ${y}): the cell holds an actor`);
	if (crowded(e, floor))
		throw new Error(`floor ${floor} is at its popCap (${e.popCap})`);
	const id = place(e, floor, compiled, x, y, at);
	if (player) {
		const { masks, maskWords } = e.storage;
		const word = e.storage.slotOf(floor, id) * maskWords;
		masks[word] = (masks[word] ?? 0) | PLAYER;
		e.players[floor] = (e.players[floor] ?? 0) + 1;
	}
	e.emit(floor, e.spawned, NO_CAUSE, id, 0);
	return id;
}

export function checkSpawn(
	e: Engine,
	floor: number,
	x: number,
	y: number,
): Cell {
	if (!(Number.isInteger(floor) && floor >= 0 && floor < e.storage.floors))
		throw new Error(`no floor ${floor}`);
	const cell = e.grid.cellAt(x, y);
	if (cell === NO_CELL)
		throw new Error(`spawn at (${x}, ${y}) is outside the floor`);
	return cell;
}

export function crowded(e: Engine, floor: number): boolean {
	const { highWater, freeCount } = e.storage;
	return (highWater[floor] ?? 0) - (freeCount[floor] ?? 0) >= e.popCap;
}

export function place(
	e: Engine,
	floor: number,
	species: CompiledSpecies,
	x: number,
	y: number,
	at: number,
): EntityId {
	if (species.actor && at > MAX_TICK)
		throw new Error(`time ${at} exceeds ${MAX_TICK}`);
	const link = species.link;
	const { grid } = e;
	if (
		link &&
		!validLink(
			floor,
			link[0] ?? 0,
			link[1] ?? 0,
			link[2] ?? 0,
			e.storage.floors,
			grid.width,
			grid.height,
		)
	)
		throw new Error(
			`a link on floor ${floor} to floor ${link[0]} at (${link[1]}, ${link[2]}) leads nowhere`,
		);
	const storage = e.storage;
	const slot = storage.alloc(floor);
	grid.insert(floor, slot, x, y);
	const { masks, maskWords } = storage;
	const { mask, columns, values } = species;
	const base = slot * maskWords;
	for (let w = 0; w < maskWords; w++)
		masks[base + w] = (masks[base + w] ?? 0) | (mask[w] ?? 0);
	for (let i = 0; i < columns.length; i++)
		(columns[i] as Column)[slot] = values[i] ?? 0;
	if (species.actor) {
		e.scheduler.nextAt[slot] = at;
		e.scheduler.push(floor, slot);
	}
	return (storage.ids[slot] ?? 0) as EntityId;
}

export function kill(
	e: Engine,
	floor: number,
	id: EntityId,
	cause: EntityId,
): void {
	const slot = e.storage.slotOf(floor, id);
	if (slot === NONE) return;
	if (((e.storage.masks[slot * e.storage.maskWords] ?? 0) & PLAYER) !== 0)
		e.players[floor] = (e.players[floor] ?? 0) - 1;
	e.grid.remove(floor, slot);
	e.scheduler.remove(floor, slot);
	e.storage.release(floor, slot);
	e.emit(floor, e.died, cause, id, 0);
}

export function applyDeferred(e: Engine, floor: number): void {
	const kills = e.kills;
	if (kills.count > 0) {
		kills.sort();
		for (let i = 0; i < kills.count; i++) {
			const n = kills.order[i] ?? 0;
			const id = (kills.ids[n] ?? 0) as EntityId;
			kill(e, floor, id, (kills.causes[n] ?? 0) as EntityId);
		}
		kills.count = 0;
	}
	const spawns = e.spawns;
	if (spawns.count > 0) {
		spawns.sort();
		const at = (e.now[floor] ?? 0) + TICKS_PER_TURN;
		const grid = e.grid;
		for (let i = 0; i < spawns.count; i++) {
			const n = spawns.order[i] ?? 0;
			const species = e.species[spawns.species[n] ?? 0] as CompiledSpecies;
			const x = spawns.xs[n] ?? 0;
			const y = spawns.ys[n] ?? 0;
			// Refused, not thrown: the batch is sorted, so which spawn loses is deterministic.
			if (
				crowded(e, floor) ||
				(species.actor && grid.holdsOtherActor(floor, grid.cellAt(x, y), NONE))
			)
				continue;
			const id = place(e, floor, species, x, y, at);
			const cause = (spawns.causes[n] ?? 0) as EntityId;
			e.emit(floor, e.spawned, cause, id, 0);
		}
		spawns.count = 0;
	}
}
