import { expect, test } from "bun:test";
import type { Entity, Snapshot } from "@korr/protocol";
import { render } from "../../src/debug/render";

function snapshot(entities: Entity[]): Snapshot {
	return {
		type: "snapshot",
		width: 4,
		height: 3,
		player: { id: 1, x: 1, y: 1, hp: 10, satiety: 800 },
		entities,
	};
}

test("a fixed snapshot renders to a fixed string", () => {
	const text = render(
		snapshot([
			[2, "rat", 0, 0],
			[3, "cheese", 3, 0],
			[4, "mushroom", 2, 2],
			[5, "dragon", 0, 2],
		]),
	);
	expect(text).toBe('r..%\n.@..\n?.".\npv 10  satiété 800');
});

test("on a shared cell the last entity in the list is drawn", () => {
	const lines = render(
		snapshot([
			[2, "rat", 2, 0],
			[3, "cheese", 2, 0],
			[4, "cheese", 3, 0],
			[5, "stoat", 3, 0],
		]),
	).split("\n");
	expect(lines[0]).toBe("..%s");
});

test("the player is drawn on top of entities on its cell", () => {
	const lines = render(snapshot([[2, "stoat", 1, 1]])).split("\n");
	expect(lines[1]).toBe(".@..");
});

test("entities outside the floor are skipped", () => {
	const text = render(
		snapshot([
			[2, "rat", 4, 0],
			[3, "rat", -1, 1],
			[4, "rat", 0, 3],
			[5, "rat", 0, -1],
		]),
	);
	expect(text).toBe("....\n.@..\n....\npv 10  satiété 800");
});
