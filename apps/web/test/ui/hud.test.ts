import { expect, test } from "bun:test";
import { initialPlay } from "../../src/play/step";
import type { Play } from "../../src/play/types";
import { connectingText, noticeTexts } from "../../src/theme";
import { hud } from "../../src/ui/hud";
import { snapshot } from "../snapshot";

function textOf(play: Play): string | null {
	const element: { textContent: string | null } = { textContent: null };
	hud(element).show({ play });
	return element.textContent;
}

const base = snapshot({ x: 4, y: 4 });
const playing: Play = {
	...initialPlay,
	status: "playing",
	snapshot: { ...base, player: { ...base.player, hp: 7, satiety: 650 } },
};

test("a rejected command shows its notice", () => {
	expect(textOf({ ...playing, notice: "rejected" })).toContain(
		noticeTexts.rejected,
	);
	expect(textOf(playing)).not.toContain(noticeTexts.rejected);
});

test("hit points come before satiety, each with its own value", () => {
	expect(textOf(playing)).toMatch(/hp 7\b.*satiety 650\b/);
});

test("before the first snapshot the hud says it is connecting and shows no stats", () => {
	expect(textOf(initialPlay)).toBe(connectingText);
	expect(textOf(playing)).not.toContain(connectingText);
});
