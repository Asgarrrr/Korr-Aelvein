import { expect, test } from "bun:test";
import { STAIR_TIME } from "../../../src/core/config";
import type { Engine } from "../../../src/core/engine";
import { spawn } from "../../../src/core/lifecycle/lifecycle";
import {
	defineModule,
	type EntityId,
	type Schema,
	type Slot,
} from "../../../src/core/module/api";
import { createEngine } from "../../../src/core/setup/registration";
import { depart, ingest } from "../../../src/core/travel/travel";
import { game } from "../../fixtures";

// Registered last, with enough components that its last ones sit in a second mask word.
const WIDE = 40;
const wide = defineModule({
	name: "wide",
	schema: Object.fromEntries(
		Array.from({ length: WIDE }, (_, i) => [`wide${i}`, { v: "u8" }]),
	) as Schema,
	config: {},
	setup() {},
});

const build = () =>
	createEngine(
		{ seed: 1, floors: 2, width: 8, height: 8, popCap: 64, events: true },
		[...game.modules, wide],
		game.species,
	);

// An actor holding every component an actor may have, each field a distinct nonzero value.
function traveller(e: Engine): Slot {
	const components: Record<string, Record<string, number>> = {};
	let n = 0;
	for (const [name, { columns }] of e.components) {
		if (name === "link") continue;
		const fields: Record<string, number> = {};
		for (const field of Object.keys(columns)) fields[field] = (n++ % 100) + 1;
		components[name] = fields;
	}
	components.vitality = { hp: 1, max: 2 };
	const id = spawn(e, 0, { actor: true, components }, 1, 1);
	const slot = e.storage.slotOf(0, id);
	e.speciesIndex[slot] = e.speciesNames.length;
	return slot;
}

function travel(e: Engine, slot: Slot): Slot {
	const id = (e.storage.ids[slot] ?? 0) as EntityId;
	e.leaveFloor = 1;
	e.leaveX = 4;
	e.leaveY = 4;
	depart(e, 0, slot, 0);
	ingest(e, 1, STAIR_TIME, STAIR_TIME + 1);
	return e.storage.slotOf(1, id);
}

test("the carried columns are exactly the component columns and the species index", () => {
	const e = build();
	const components = [
		e.speciesIndex,
		...[...e.components.values()].flatMap((c) => Object.values(c.columns)),
	];
	expect(e.carried.length).toBe(components.length);
	expect(components.every((c) => e.carried.includes(c))).toBe(true);
});

test("a traveller arrives with every mask word and every carried column", () => {
	const e = build();
	const slot = traveller(e);
	const words = e.storage.maskWords;
	const maskOf = (s: Slot) =>
		Array.from(e.storage.masks.subarray(s * words, (s + 1) * words));
	const rowOf = (s: Slot) => e.carried.map((column) => column[s] ?? 0);
	const mask = maskOf(slot);
	const row = rowOf(slot);
	expect(words).toBeGreaterThan(1);
	expect(mask.at(-1)).not.toBe(0);
	expect(row.at(-1)).not.toBe(0);
	const arrived = travel(e, slot);
	expect(maskOf(arrived)).toEqual(mask);
	expect(rowOf(arrived)).toEqual(row);
});

test("an arrival has no cached intent and is due at its arrival time", () => {
	const e = build();
	const slot = traveller(e);
	e.intentKey[slot] = 7;
	e.intentTarget[slot] = 9;
	const arrived = travel(e, slot);
	expect(e.intentKey[arrived]).toBe(0);
	expect(e.intentTarget[arrived]).toBe(0);
	expect(e.scheduler.nextAt[arrived]).toBe(STAIR_TIME);
});
