import { expect, test } from "bun:test";
import type { Snapshot } from "@korr/protocol";
import { asciiView } from "../../src/debug/ascii";
import { initialPlay } from "../../src/play/step";
import { floorGlyph, stems, unknownStem } from "../../src/theme";

const glyph = (stem: string) => stems.get(stem)?.glyph ?? `no ${stem} row`;

test("a non-square floor draws each cell from the theme", () => {
	const snapshot: Snapshot = {
		type: "snapshot",
		width: 4,
		height: 2,
		player: { id: 1, x: 3, y: 0, hp: 10, satiety: 800 },
		entities: [
			[2, "rat", 1, 0],
			[3, "dragon.0", 0, 1],
			[4, "stoat.1", 2, 1],
			[5, "rat", 4, 0],
		],
		looks: {
			rat: { stem: "rat", tier: 0 },
			"dragon.0": { stem: "dragon", tier: 0 },
			"stoat.1": { stem: "stoat", tier: 1 },
		},
	};
	const element: { textContent: string | null } = { textContent: null };
	asciiView(element).show({ play: { ...initialPlay, snapshot } });

	expect(element.textContent?.split("\n").map((row) => [...row])).toEqual([
		[floorGlyph, glyph("rat"), floorGlyph, glyph("player")],
		[unknownStem.glyph, floorGlyph, glyph("stoat").toUpperCase(), floorGlyph],
	]);
});

test("a player at x === width does not appear in the next row", () => {
	const snapshot: Snapshot = {
		type: "snapshot",
		width: 3,
		height: 2,
		player: { id: 1, x: 3, y: 0, hp: 10, satiety: 800 },
		entities: [],
		looks: {},
	};
	const element: { textContent: string | null } = { textContent: null };
	asciiView(element).show({ play: { ...initialPlay, snapshot } });

	expect(element.textContent).not.toContain(glyph("player"));
});
