import { MAX_TICK, TICKS_PER_TURN } from "../config";
import { type Cell, type EntityId, NO_CELL, NONE } from "../ecs/ids";
import type { Column } from "../ecs/schema";
import { PLAYER } from "../ecs/storage";
import type { Engine } from "../engine";
import { bounded, draw, PHASE, SUBJECT } from "../random/rng";
import { frozenCopy } from "../setup/canonical";
import { validLink } from "../travel/link";
import { attach, detach } from "./membership";
import {
	type CompiledSpecies,
	checkField,
	checkHealth,
	checkKey,
	compileSpecies,
	type RangeDraw,
	type SpeciesShape,
	speciesError,
} from "./species";

const NO_CAUSE = 0 as EntityId;

export interface SpawnValues {
	readonly [component: string]:
		| { readonly [field: string]: number | undefined }
		| undefined;
}

// A shape compiles on every call, from a frozen copy so its getters run once: a direct spawn is
// setup work, and a cache would serve an edited object stale. A name is the fast path.
export function spawn(
	e: Engine,
	floor: number,
	species: string | SpeciesShape,
	x: number,
	y: number,
	player = false,
	values?: SpawnValues,
): EntityId {
	const cell = checkSpawn(e, floor, x, y);
	let compiled: CompiledSpecies | undefined;
	let count = 0;
	// World refuses every change while set: a getter must not move the world under this spawn.
	e.spawning = true;
	try {
		compiled =
			typeof species === "string"
				? e.speciesByName.get(species)
				: compileSpecies(
						frozenCopy(species),
						e.components,
						e.storage.maskWords,
					);
		if (!compiled) throw new Error(`no species ${species} in this world`);
		if (values !== undefined) count = readValues(e, compiled, values);
	} finally {
		e.spawning = false;
	}
	// A floor's own clock: mid-round, a newcomer acts no earlier than the floor has reached.
	const at = e.now[floor] ?? 0;
	if (player && !compiled.actor) throw new Error("a player must be an actor");
	if (compiled.actor && e.grid.holdsOtherActor(floor, cell, NONE))
		throw new Error(`spawn at (${x}, ${y}): the cell holds an actor`);
	if (crowded(e, floor))
		throw new Error(`floor ${floor} is at its popCap (${e.popCap})`);
	const id = place(e, floor, compiled, x, y, at, count, player);
	e.emit(floor, e.spawned, NO_CAUSE, id, 0);
	return id;
}

// The species' field checks, and vitality with the values applied; place checks the link.
function readValues(
	e: Engine,
	species: CompiledSpecies,
	values: SpawnValues,
): number {
	const { spawnColumns, spawnValues } = e;
	const { label } = species;
	let count = 0;
	for (const componentName in values) {
		checkKey(componentName, label);
		// As in a shape: a component no registered module owns is skipped.
		const component = e.components.get(componentName);
		if (!component) continue;
		const { word, bit } = component.bit;
		if (((species.mask[word] ?? 0) & bit) === 0)
			throw speciesError(
				label,
				`values for ${componentName}, which the species lacks`,
			);
		const fields = values[componentName];
		for (const field in fields) {
			const value = fields[field];
			spawnColumns[count] = checkField(
				component,
				componentName,
				field,
				value,
				label,
			);
			spawnValues[count] = value ?? 0;
			count++;
		}
	}
	const { hp, max, word, bit } = e.vitality;
	if (((species.mask[word] ?? 0) & bit) !== 0)
		checkHealth(
			given(e, count, hp, ownValue(species, hp)),
			given(e, count, max, ownValue(species, max)),
			label,
		);
	return count;
}

function given(
	e: Engine,
	count: number,
	column: Column,
	otherwise: number,
): number {
	for (let i = 0; i < count; i++)
		if (e.spawnColumns[i] === column) return e.spawnValues[i] ?? 0;
	return otherwise;
}

function ownValue(species: CompiledSpecies, column: Column): number {
	return species.values[species.columns.indexOf(column)] ?? 0;
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
	overrides: number,
	player = false,
): EntityId {
	if (species.actor && at > MAX_TICK)
		throw new Error(`time ${at} exceeds ${MAX_TICK}`);
	const link = species.link;
	const { grid } = e;
	if (link) {
		const to = given(e, overrides, e.link.floor, link[0] ?? 0);
		const toX = given(e, overrides, e.link.x, link[1] ?? 0);
		const toY = given(e, overrides, e.link.y, link[2] ?? 0);
		const { floors } = e.storage;
		if (!validLink(floor, to, toX, toY, floors, grid.width, grid.height))
			throw new Error(
				`a link on floor ${floor} to floor ${to} at (${toX}, ${toY}) leads nowhere`,
			);
	}
	const storage = e.storage;
	const slot = storage.alloc(floor);
	const { masks, maskWords } = storage;
	const { mask, columns, values } = species;
	const base = slot * maskWords;
	for (let w = 0; w < maskWords; w++)
		masks[base + w] = (masks[base + w] ?? 0) | (mask[w] ?? 0);
	if (player) masks[base] = (masks[base] ?? 0) | PLAYER;
	e.speciesIndex[slot] = species.index;
	for (let i = 0; i < columns.length; i++)
		(columns[i] as Column)[slot] = values[i] ?? 0;
	if (species.ranges.length > 0) drawRanges(e, slot, species.ranges, overrides);
	const { spawnColumns, spawnValues } = e;
	for (let i = 0; i < overrides; i++)
		(spawnColumns[i] as Column)[slot] = spawnValues[i] ?? 0;
	attach(e, floor, slot, x, y, at);
	return (storage.ids[slot] ?? 0) as EntityId;
}

function drawRanges(
	e: Engine,
	slot: number,
	ranges: readonly RangeDraw[],
	overrides: number,
): void {
	const id = e.storage.ids[slot] ?? 0;
	const { seed, spawnColumns } = e;
	next: for (let i = 0; i < ranges.length; i++) {
		const { column, min, max, ownerKey, fieldKey } = ranges[i] as RangeDraw;
		for (let j = 0; j < overrides; j++)
			if (spawnColumns[j] === column) continue next;
		const width = max - min + 1;
		// A birth draw ignores time, so the time slot tells the two draws apart.
		const a = draw(
			seed,
			ownerKey,
			PHASE.spawn,
			0,
			SUBJECT.entity,
			id,
			fieldKey,
		);
		const b = draw(
			seed,
			ownerKey,
			PHASE.spawn,
			1,
			SUBJECT.entity,
			id,
			fieldKey,
		);
		// An odd sum rounds up or down on a spare bit of b: flooring would favour min.
		column[slot] =
			min + ((bounded(a, width) + bounded(b, width) + (b & 1)) >> 1);
	}
}

export function kill(
	e: Engine,
	floor: number,
	id: EntityId,
	cause: EntityId,
): void {
	const slot = e.storage.slotOf(floor, id);
	if (slot === NONE) return;
	detach(e, floor, slot);
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
			const id = place(e, floor, species, x, y, at, 0);
			const cause = (spawns.causes[n] ?? 0) as EntityId;
			e.emit(floor, e.spawned, cause, id, 0);
		}
		spawns.count = 0;
	}
}
