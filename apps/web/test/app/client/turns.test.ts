import { afterEach, expect, mock, spyOn, test } from "bun:test";
import type { Command } from "@korr/protocol";
import { createClient } from "../../../src/app/client";
import type { PlayEvent } from "../../../src/play/types";
import { motion } from "../../../src/theme";
import { outCubic } from "../../../src/view/easing";
import type { Poses } from "../../../src/view/sample";
import { snapshot } from "../../snapshot";
import {
	consumers,
	down,
	fakeFrames,
	opening,
	reply,
	right,
	started,
	wait,
} from "./harness";

afterEach(() => {
	mock.restore();
});

test.each([0, 1])("without consumer %d the game still advances", (removed) => {
	const sent: Command[] = [];
	let deliver: (event: PlayEvent) => void = () => {};
	const clock = fakeFrames();
	const client = createClient({
		connect: (onEvent) => {
			deliver = onEvent;
			return { send: (command) => sent.push(command), close: () => {} };
		},
		consumers: consumers().filter((_, i) => i !== removed),
		ended: () => {},
		requestFrame: clock.requestFrame,
		turnMs: clock.turnMs,
	});

	for (const x of [4, 5]) {
		deliver({ type: "message", message: snapshot({ x, y: 4 }) });
		clock.settle();
		expect(client.press(right)).toBe(true);
	}

	expect(sent).toEqual([
		{ type: "move", dx: 1, dy: 0 },
		{ type: "move", dx: 1, dy: 0 },
	]);
});

test("consumers get one frame on start and one per changed play", () => {
	const { frames, client, clock, deliver } = started();
	expect(frames).toHaveLength(1);

	deliver(opening);
	expect(frames).toHaveLength(2);

	clock.settle();
	expect(frames).toHaveLength(3);

	expect(client.press({ ...right, key: "e", code: "KeyE", keyCode: 69 })).toBe(
		true,
	);
	expect(frames).toHaveLength(3);

	client.press(right);
	expect(frames).toHaveLength(4);
});

test("a rejected command logs the command that was sent", () => {
	const logged = spyOn(console, "error").mockImplementation(() => {});
	const { client, clock, sent, deliver } = started();
	deliver(opening);
	clock.settle();
	client.press(right);
	deliver({
		type: "message",
		message: { type: "rejected", reason: "invalid" },
	});
	expect(logged).toHaveBeenCalledWith(expect.any(String), sent[0]);
});

test("three presses, each after the previous reply has settled, send three commands in order", () => {
	const { client, clock, sent, deliver } = started();
	deliver(opening);
	for (const [x, key] of [right, down, wait].entries()) {
		clock.settle();
		client.press(key);
		deliver({ type: "message", message: snapshot({ x, y: 4 }) });
	}
	expect(sent).toEqual([
		{ type: "move", dx: 1, dy: 0 },
		{ type: "move", dx: 0, dy: 1 },
		{ type: "wait" },
	]);
});

test("each turn's first frame draws the player on its previous cell", () => {
	const drawn: Poses[] = [];
	const { client, clock, deliver } = started([
		{ show: () => {}, draw: (poses) => drawn.push(poses) },
	]);
	deliver(opening);
	clock.settle();
	client.press(right);
	deliver(reply);
	clock.tick();

	expect(drawn.at(-1)?.player).toMatchObject({ x: 4, y: 4 });
});

test("a mid-turn frame draws the eased progress", () => {
	const drawn: Poses[] = [];
	const { client, clock, deliver } = started([
		{ show: () => {}, draw: (poses) => drawn.push(poses) },
	]);
	deliver(opening);
	clock.settle();
	client.press(right);
	deliver(reply);
	clock.tick();
	clock.tick(motion.turnMs / 2);

	expect(drawn.at(-1)?.player.x).toBe(4 + outCubic(1 / 2));
});

test("a gesture queued mid-turn is sent on the frame where progress reaches 1, not before", () => {
	const { client, clock, sent, deliver } = started();
	deliver(opening);
	clock.settle();
	client.press(right);
	deliver(reply);
	client.press(down);

	clock.tick();
	clock.tick(motion.turnMs / 2);
	expect(sent).toHaveLength(1);

	clock.tick(motion.turnMs / 2);
	expect(sent).toEqual([
		{ type: "move", dx: 1, dy: 0 },
		{ type: "move", dx: 0, dy: 1 },
	]);
});

test("two snapshots with no frame between them leave one pending frame", () => {
	const { clock, deliver } = started();
	deliver(opening);
	deliver(reply);
	expect(clock.pending()).toBe(1);
});
