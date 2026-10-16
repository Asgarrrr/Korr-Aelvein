import { expect, test } from "bun:test";
import type { Command } from "@korr/protocol";
import { createClient } from "../../src/app/client";
import { asciiView } from "../../src/debug/ascii";
import type { KeyPress } from "../../src/input/keys";
import type { Play, PlayEvent } from "../../src/play/types";
import { connectingText, noticeTexts } from "../../src/theme";
import { hud } from "../../src/ui/hud";
import { snapshot } from "../snapshot";

const right: KeyPress = {
	key: "l",
	code: "KeyL",
	repeat: false,
	ctrlKey: false,
	altKey: false,
	metaKey: false,
	isComposing: false,
	keyCode: 76,
};

const consumers = () => [
	asciiView({ textContent: null }),
	hud({ textContent: null }),
];

test.each([0, 1])("without consumer %d the game still advances", (removed) => {
	const sent: Command[] = [];
	let deliver: (event: PlayEvent) => void = () => {};
	const client = createClient({
		connect: (onEvent) => {
			deliver = onEvent;
			return { send: (command) => sent.push(command) };
		},
		consumers: consumers().filter((_, i) => i !== removed),
	});

	for (const x of [4, 5]) {
		deliver({ type: "message", message: snapshot({ x, y: 4 }) });
		expect(client.press(right)).toBe(true);
	}

	expect(sent).toEqual([
		{ type: "move", dx: 1, dy: 0 },
		{ type: "move", dx: 1, dy: 0 },
	]);
});

function started() {
	const frames: Play[] = [];
	const text = { textContent: null as string | null };
	let deliver: (event: PlayEvent) => void = () => {};
	const client = createClient({
		connect: (onEvent) => {
			deliver = onEvent;
			return { send: () => {} };
		},
		consumers: [{ show: ({ play }) => frames.push(play) }, hud(text)],
	});
	return {
		frames,
		text,
		client,
		deliver: (event: PlayEvent) => deliver(event),
	};
}

test("consumers get one frame on start and one per changed play", () => {
	const { frames, client, deliver } = started();
	expect(frames).toHaveLength(1);

	deliver({ type: "message", message: snapshot({ x: 4, y: 4 }) });
	expect(frames).toHaveLength(2);

	client.press(right);
	expect(frames).toHaveLength(3);

	client.press(right);
	client.press({ ...right, key: "z", code: "KeyZ", keyCode: 90 });
	expect(frames).toHaveLength(3);
});

test("a close before any snapshot shows one status line", () => {
	const { text, deliver } = started();
	expect(text.textContent).toBe(connectingText);

	deliver({ type: "closed" });
	expect(text.textContent).toBe(noticeTexts.closed);
});
