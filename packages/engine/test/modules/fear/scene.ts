import { species } from "../../../src/content/species";
import { rat } from "../../../src/content/species/rat";
import { stoat } from "../../../src/content/species/stoat";
import { spawn } from "../../../src/core/lifecycle/lifecycle";
import {
	type ActionCtx,
	ALTERNATE,
	type AnyModule,
	type EntityId,
	NONE,
} from "../../../src/core/module/api";
import { createEngine } from "../../../src/core/setup/registration";
import { explore } from "../../../src/modules/explore";
import { wander } from "../../../src/modules/wander";
import { modules } from "../../../src/registry";

// Without wander and explore, sated stoats stand still: only fear and hunger move a rat.
export const still = modules.filter((m) => m !== wander && m !== explore);
export const SHY = 0;
export const BOLD = 255;

// One floor without players, so every actor decides in full every round.
export const scene = (side: number, list: readonly AnyModule[] = still) => {
	const engine = createEngine(
		{
			seed: 1,
			floors: 1,
			width: side,
			height: side,
			popCap: 2048,
			events: false,
		},
		list,
		species,
	);
	// intentKey is an Int32Array, so a key above 2^31 reads back negative.
	const names = new Map(engine.actions.map((a) => [a.key | 0, a.name]));
	const slot = (id: EntityId) => engine.storage.slotOf(0, id);
	const intent = (id: EntityId) =>
		names.get(engine.intentKey[slot(id)] ?? 0) ?? "none";
	const xOf = (id: EntityId) => engine.grid.x[slot(id)] ?? 0;
	const ratAt = (x: number, y: number, boldness?: number, satiety?: number) =>
		spawn(engine, 0, rat, x, y, false, {
			...(boldness === undefined ? {} : { temperament: { boldness } }),
			...(satiety === undefined ? {} : { satiety: { value: satiety } }),
		});
	const stoatAt = (x: number, y: number) => spawn(engine, 0, stoat, x, y);
	return { engine, intent, xOf, ratAt, stoatAt };
};

// An action ctx over a few bodies on a side x side floor, as [slot, id, x, y]; fear reads sight
// from the grid lists. `crowded`: every cell holds an actor.
export const gridCtx = (
	bodies: readonly [number, EntityId, number, number][],
	side: number,
	crowded = false,
) => {
	const at = (slot: number) => bodies.find(([s]) => s === slot);
	const cellOf = (slot: number) => {
		const body = at(slot);
		return body ? body[3] * side + body[2] : NONE;
	};
	const inCell = (cell: number) =>
		bodies.filter(([s]) => cellOf(s) === cell).map(([s]) => s);
	return {
		width: side,
		height: side,
		x: (slot: number) => at(slot)?.[2] ?? 0,
		y: (slot: number) => at(slot)?.[3] ?? 0,
		cellAt: (x: number, y: number) => y * side + x,
		cellOf,
		slotOf: (id: EntityId) => bodies.find(([, i]) => i === id)?.[0] ?? NONE,
		firstAt: (cell: number) => inCell(cell)[0] ?? NONE,
		nextAt: (slot: number) => {
			const list = inCell(cellOf(slot));
			return list[list.indexOf(slot) + 1] ?? NONE;
		},
		holdsActor: () => crowded,
		instead: () => ALTERNATE,
	} as unknown as ActionCtx;
};
