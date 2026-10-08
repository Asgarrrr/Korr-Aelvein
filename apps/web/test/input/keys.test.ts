import { expect, test } from "bun:test";
import type { Entity, Snapshot } from "@korr/protocol";
import { commandFor } from "../../src/input/keys";

function snapshot(entities: Entity[] = []): Snapshot {
	return {
		type: "snapshot",
		width: 8,
		height: 8,
		player: { id: 1, x: 4, y: 4, hp: 10, satiety: 800 },
		entities,
	};
}

test.each([
	["ArrowLeft", -1, 0],
	["j", 0, 1],
	["n", 1, 1],
])("%s moves by (%d, %d)", (key, dx, dy) => {
	expect(commandFor(key, snapshot())).toEqual({ type: "move", dx, dy });
});

test(". waits", () => {
	expect(commandFor(".", snapshot())).toEqual({ type: "wait" });
});

test("an unknown key, or a key named like an Object property, gives no command", () => {
	expect(commandFor("q", snapshot())).toBeUndefined();
	expect(commandFor("constructor", snapshot())).toBeUndefined();
});

test("e eats the lowest-id adjacent edible entity", () => {
	const command = commandFor(
		"e",
		snapshot([
			[9, "cheese", 5, 5],
			[7, "mushroom", 3, 4],
			[8, "cheese", 4, 4],
		]),
	);
	expect(command).toEqual({ type: "eat", target: 7 });
});

test("e eats an edible entity on the player's cell", () => {
	const command = commandFor("e", snapshot([[3, "cheese", 4, 4]]));
	expect(command).toEqual({ type: "eat", target: 3 });
});

test("e skips non-edible and non-adjacent entities to pick an adjacent edible one", () => {
	const command = commandFor(
		"e",
		snapshot([
			[2, "stoat", 4, 5],
			[3, "moss", 3, 3],
			[4, "cheese", 6, 4],
			[5, "mushroom", 2, 2],
			[6, "cheese", 5, 3],
		]),
	);
	expect(command).toEqual({ type: "eat", target: 6 });
});

test("e gives no command with no entity, or with only non-edible or distant ones", () => {
	expect(commandFor("e", snapshot())).toBeUndefined();
	expect(
		commandFor(
			"e",
			snapshot([
				[2, "stoat", 4, 5],
				[3, "cheese", 6, 6],
			]),
		),
	).toBeUndefined();
});
