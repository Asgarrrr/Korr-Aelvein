import { species } from "../../../src/content/species";
import { rat } from "../../../src/content/species/rat";
import { stoat } from "../../../src/content/species/stoat";
import { spawn } from "../../../src/core/lifecycle/lifecycle";
import type { AnyModule, EntityId } from "../../../src/core/module/api";
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
	const names = new Map(engine.actions.map((a) => [a.key, a.name]));
	const slot = (id: EntityId) => engine.storage.slotOf(0, id);
	const intent = (id: EntityId) =>
		names.get(engine.intentKey[slot(id)] ?? 0) ?? "none";
	const target = (id: EntityId) => engine.intentTarget[slot(id)] ?? 0;
	const xOf = (id: EntityId) => engine.grid.x[slot(id)] ?? 0;
	const ratAt = (x: number, y: number, boldness?: number, satiety?: number) =>
		spawn(engine, 0, rat, x, y, false, {
			...(boldness === undefined ? {} : { temperament: { boldness } }),
			...(satiety === undefined ? {} : { satiety: { value: satiety } }),
		});
	const stoatAt = (x: number, y: number) => spawn(engine, 0, stoat, x, y);
	return { engine, intent, target, xOf, ratAt, stoatAt };
};
