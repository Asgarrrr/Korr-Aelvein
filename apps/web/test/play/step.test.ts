import { expect, test } from "bun:test";
import type { Command, ServerMessage } from "@korr/protocol";
import { initialPlay, step } from "../../src/play/step";
import type { Gesture, Play, PlayEvent } from "../../src/play/types";
import { snapshot } from "../snapshot";

const east: Gesture = { kind: "move", dx: 1, dy: 0 };
const eat: Gesture = { kind: "eat" };

function run(events: PlayEvent[], from: Play = initialPlay) {
	let play = from;
	const sent: Command[] = [];
	for (const event of events) {
		const result = step(play, event);
		play = result.play;
		if (result.send) sent.push(result.send);
	}
	return { play, sent };
}

const message = (message: ServerMessage): PlayEvent => ({
	type: "message",
	message,
});
const gesture = (gesture: Gesture): PlayEvent => ({ type: "gesture", gesture });
const opening = message(snapshot({ x: 4, y: 4 }));

test("a gesture after the snapshot sends its command", () => {
	expect(run([opening, gesture(east)]).sent).toEqual([
		{ type: "move", dx: 1, dy: 0 },
	]);
});

test("a gesture while a command is in flight sends nothing", () => {
	expect(run([opening, gesture(east), gesture(east)]).sent).toHaveLength(1);
});

test("a gesture before the first snapshot or after the game is over sends nothing", () => {
	expect(run([gesture(east)]).sent).toEqual([]);
	expect(run([opening, message({ type: "over" }), gesture(east)]).sent).toEqual(
		[],
	);
});

test("eat targets the lowest-id adjacent edible entity of the newest snapshot", () => {
	const { sent } = run([
		message(snapshot({ x: 4, y: 4 }, [[3, "cheese", 4, 5]])),
		gesture(east),
		message(
			snapshot({ x: 5, y: 4 }, [
				[1, "cheese", 7, 4],
				[2, "rat", 5, 5],
				[9, "cheese", 6, 3],
				[7, "mushroom", 4, 5],
				[8, "stoat", 5, 4],
			]),
		),
		gesture(eat),
	]);
	expect(sent.at(-1)).toEqual({ type: "eat", target: 7 });
});

test("eat with no adjacent edible entity sends nothing and keeps the turn open", () => {
	const { sent } = run([
		message(
			snapshot({ x: 4, y: 4 }, [
				[2, "stoat", 4, 5],
				[3, "cheese", 6, 6],
			]),
		),
		gesture(eat),
		gesture(east),
	]);
	expect(sent).toEqual([{ type: "move", dx: 1, dy: 0 }]);
});

test("a rejected command leaves a notice until the next server message", () => {
	const rejected = run([
		opening,
		gesture(east),
		message({ type: "rejected", reason: "invalid" }),
	]);
	expect(rejected.play.notice).toBe("rejected");

	const retried = run([gesture(east)], rejected.play);
	expect(retried.sent).toHaveLength(1);
	expect(retried.play.notice).toBe("rejected");

	expect(run([opening], retried.play).play.notice).toBeUndefined();
});

const opened: PlayEvent = { type: "open" };
const closed = (detail: string): PlayEvent => ({ type: "closed", detail });
const fault = (detail: string): PlayEvent => ({ type: "fault", detail });

test("an ending is final: over then closed, a fault or a snapshot stays over", () => {
	const over = run([opening, message({ type: "over" })]).play;
	expect(run([closed("1006")], over).play).toBe(over);
	expect(run([fault("late"), opening], over).play).toBe(over);
});

test("broken keeps its first detail", () => {
	const { play } = run([
		opening,
		fault("first"),
		fault("second"),
		closed("1006"),
	]);
	expect(play.status).toEqual({ kind: "broken", detail: "first" });
});

test.each([
	["before the socket opened", "unreachable", "1006", []],
	["after the socket opened", "dropped", "1011", [opened]],
	["after the socket opened", "dropped", "1006", [opened, opening]],
] as const)("a close %s is lost/%s, detail %s", (_, cause, code, before) => {
	const { play } = run([...before, closed(code)]);
	expect(play.status).toEqual({ kind: "lost", cause, detail: code });
});

test("rejected: over while playing is broken", () => {
	const { play } = run([
		opened,
		opening,
		gesture(east),
		message({ type: "rejected", reason: "over" }),
	]);
	expect(play.status).toMatchObject({ kind: "broken" });
});
