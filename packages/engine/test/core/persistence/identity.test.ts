import { expect, test } from "bun:test";
import type { EntityId } from "../../../src/core/api";
import { ID_FLOOR_STRIDE } from "../../../src/core/config";
import { ACTOR, ALIVE } from "../../../src/core/ecs/storage";
import { spawn } from "../../../src/core/lifecycle/lifecycle";
import { saveWorld } from "../../../src/core/persistence/save";
import { createEngine } from "../../../src/core/setup/registration";
import { ENTRY_HEAD } from "../../../src/core/travel/inbox";
import { loadWorld } from "../../../src/core/world";

// Saves built from a forged engine: every checksum is valid, only the ids are wrong.
const forge = (edit: (e: ReturnType<typeof createEngine>) => void) => {
	const e = createEngine(
		{ seed: 1, floors: 2, width: 4, height: 4, popCap: 16, events: true },
		[],
	);
	const body = { actor: true, components: {} };
	spawn(e, 0, body, 0, 0);
	spawn(e, 0, body, 1, 0);
	spawn(e, 1, body, 0, 0);
	edit(e);
	return saveWorld(e);
};
const firstOf = (floor: number) => (floor * ID_FLOOR_STRIDE + 1) as EntityId;
const slotOf = (e: ReturnType<typeof createEngine>, floor: number) =>
	e.storage.slotOf(floor, firstOf(floor));

test("an unforged save loads", () => {
	expect(() =>
		loadWorld(
			forge(() => {}),
			{ modules: [] },
		),
	).not.toThrow();
});

test("an id living on two floors never loads", () => {
	const bytes = forge((e) => {
		e.storage.ids[slotOf(e, 1)] = firstOf(0);
	});
	expect(() => loadWorld(bytes, { modules: [] })).toThrow(/twice/);
});

test("an id both on a floor and in an inbox never loads", () => {
	const bytes = forge((e) => {
		const at = e.inbox.insert(1, 100, firstOf(0), 2, 2);
		e.inbox.words(1)[at + ENTRY_HEAD] = ALIVE | ACTOR;
	});
	expect(() => loadWorld(bytes, { modules: [] })).toThrow(/twice/);
});

test("an id its origin floor never issued never loads", () => {
	const bytes = forge((e) => {
		e.storage.ids[slotOf(e, 1)] = firstOf(0) + 5;
	});
	expect(() => loadWorld(bytes, { modules: [] })).toThrow(/never issued/);
});
