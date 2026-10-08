import { expect, test } from "bun:test";
import { ID_FLOOR_STRIDE } from "../../../src/core/config";
import { spawn } from "../../../src/core/lifecycle/lifecycle";
import type { EntityId } from "../../../src/core/module/api";
import { saveWorld } from "../../../src/core/persistence/save";
import { createEngine } from "../../../src/core/setup/registration";
import { loadWorld } from "../../../src/core/world/world";

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

test("an id both on a floor and in an inbox never loads", () => {
	const bytes = forge((e) => {
		e.inbox.post(1, 100, firstOf(0), 2, 2, slotOf(e, 0));
	});
	expect(() => loadWorld(bytes, { modules: [] })).toThrow(/twice/);
});

test("an id its origin floor never issued never loads", () => {
	const bytes = forge((e) => {
		e.storage.ids[slotOf(e, 1)] = firstOf(0) + 5;
	});
	expect(() => loadWorld(bytes, { modules: [] })).toThrow(/never issued/);
});
