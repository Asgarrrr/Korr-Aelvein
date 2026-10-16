import { expect, test } from "bun:test";
import type { ServerMessage } from "@korr/protocol";
import { decode } from "../../src/net/decode";

const snapshot = {
	type: "snapshot",
	width: 6,
	height: 4,
	player: { id: 1, x: 2, y: 3, hp: 10, satiety: 800 },
	entities: [
		[2, "rat", 0, 0],
		[2 ** 31 - 1, "herbivore.0", 5, 3],
	],
	looks: {
		rat: { stem: "rat", tier: 1 },
		"herbivore.0": { stem: "rat", tier: 0 },
	},
} satisfies ServerMessage;

test.each([
	snapshot,
	{ type: "over" },
	{ type: "rejected", reason: "invalid" },
	{ type: "rejected", reason: "over" },
] satisfies ServerMessage[])("decodes %o", (message) => {
	expect(decode(JSON.stringify(message))).toEqual(message);
});

test("ignores extra fields", () => {
	const extra = {
		...snapshot,
		seq: 4,
		player: { ...snapshot.player, name: "rat" },
		looks: { rat: { stem: "rat", tier: 0, hue: 3 } },
	};
	expect(decode(JSON.stringify(extra))).toEqual({
		...snapshot,
		looks: { rat: { stem: "rat", tier: 0 } },
	});
});

const broken = (patch: Record<string, unknown>) =>
	JSON.stringify({ ...snapshot, ...patch });

test.each([
	["invalid JSON", "{"],
	["null", "null"],
	["a number", "3"],
	["an array", "[]"],
	["an unknown type", JSON.stringify({ type: "hello" })],
	["an unknown reason", JSON.stringify({ type: "rejected", reason: "busy" })],
	["a missing reason", JSON.stringify({ type: "rejected" })],
	["a fractional width", broken({ width: 6.5 })],
	["an unsafe integer", broken({ height: 2 ** 53 })],
	["a string hp", broken({ player: { ...snapshot.player, hp: "10" } })],
	["a missing player", broken({ player: undefined })],
	["a player id of 0", broken({ player: { ...snapshot.player, id: 0 } })],
	["an entity id of 0", broken({ entities: [[0, "rat", 0, 0]] })],
	["an entity id of 2^31", broken({ entities: [[2 ** 31, "rat", 0, 0]] })],
	["an entity tuple of 3", broken({ entities: [[2, "rat", 0]] })],
	["an entity tuple of 5", broken({ entities: [[2, "rat", 0, 0, 0]] })],
	["a numeric species", broken({ entities: [[2, 7, 0, 0]] })],
	["a fractional entity x", broken({ entities: [[2, "rat", 0.5, 0]] })],
	[
		"a fractional satiety",
		broken({ player: { ...snapshot.player, satiety: 800.5 } }),
	],
	[
		"an object-shaped entity",
		broken({ entities: [{ 0: 2, 1: "rat", 2: 0, 3: 0, length: 4 }] }),
	],
	["entities not an array", broken({ entities: {} })],
	["looks an array", broken({ looks: [] })],
	["a look with no stem", broken({ looks: { rat: { tier: 0 } } })],
	["a numeric stem", broken({ looks: { rat: { stem: 1, tier: 0 } } })],
	["a fractional tier", broken({ looks: { rat: { stem: "rat", tier: 0.5 } } })],
	["a negative tier", broken({ looks: { rat: { stem: "rat", tier: -1 } } })],
])("rejects %s", (_, text) => {
	expect(decode(text)).toBeUndefined();
});
