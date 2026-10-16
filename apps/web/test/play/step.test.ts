import { expect, test } from "bun:test";
import type { Command, Entity, ServerMessage, Snapshot } from "@korr/protocol";
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
const settled: PlayEvent = { type: "settled" };

test("a gesture after the snapshot sends its command", () => {
	expect(run([opening, settled, gesture(east)]).sent).toEqual([
		{ type: "move", dx: 1, dy: 0 },
	]);
});

test("a gesture while a command is in flight sends nothing", () => {
	expect(
		run([opening, settled, gesture(east), gesture(east)]).sent,
	).toHaveLength(1);
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
		settled,
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
		settled,
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
		settled,
		gesture(eat),
		gesture(east),
	]);
	expect(sent).toEqual([{ type: "move", dx: 1, dy: 0 }]);
});

test("a rejected command leaves a notice until the next server message", () => {
	const rejected = run([
		opening,
		settled,
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

const wait: Gesture = { kind: "wait" };
const moved = (
	player: { x: number; y: number },
	entities: Entity[] = [],
	looks: Snapshot["looks"] = {},
	hp = snapshot(player).player.hp,
): PlayEvent => {
	const next = snapshot(player, entities);
	return message({ ...next, player: { ...next.player, hp }, looks });
};
const inFlightWith = (queued: Gesture) => [
	opening,
	settled,
	gesture(east),
	gesture(queued),
];

test("a gesture during an unsettled turn is queued and sent once the turn settles", () => {
	const queued = run([opening, gesture(east)]);
	expect(queued.sent).toEqual([]);
	expect(run([settled], queued.play).sent).toEqual([
		{ type: "move", dx: 1, dy: 0 },
	]);
});

test("a queued gesture is sent once", () => {
	const { sent } = run([
		opening,
		gesture(east),
		settled,
		moved({ x: 5, y: 4 }),
		settled,
	]);
	expect(sent).toHaveLength(1);
});

test("the latest queued gesture wins", () => {
	const { sent } = run([
		...inFlightWith(east),
		gesture(wait),
		moved({ x: 5, y: 4 }),
		settled,
	]);
	expect(sent).toEqual([{ type: "move", dx: 1, dy: 0 }, { type: "wait" }]);
});

test("a queued eat resolves its target against the snapshot it is sent on", () => {
	const { sent } = run([
		message(snapshot({ x: 4, y: 4 }, [[3, "cheese", 4, 5]])),
		settled,
		gesture(east),
		gesture(eat),
		moved({ x: 6, y: 4 }, [
			[3, "cheese", 4, 5],
			[7, "cheese", 6, 5],
		]),
		settled,
	]);
	expect(sent.at(-1)).toEqual({ type: "eat", target: 7 });
});

test("a queued eat with no target left is discarded on the snapshot", () => {
	const { play } = run([
		message(snapshot({ x: 4, y: 4 }, [[3, "cheese", 4, 5]])),
		settled,
		gesture(east),
		gesture(eat),
		moved({ x: 6, y: 4 }, [[3, "cheese", 4, 5]]),
	]);
	expect(play.queued).toBeUndefined();
});

test("an HP drop discards the queued gesture", () => {
	const hp = snapshot({ x: 4, y: 4 }).player.hp;
	const { sent } = run([
		...inFlightWith(east),
		moved({ x: 5, y: 4 }, [], {}, hp - 1),
		settled,
	]);
	expect(sent).toHaveLength(1);
});

const move = (dx: -1 | 0 | 1, dy: -1 | 0 | 1): Gesture => ({
	kind: "move",
	dx,
	dy,
});
test.each([
	["a rat", 1, "rat", { rat: { stem: "rat", tier: 0 } }, move(1, 0), [6, 4]],
	[
		"a generated rat",
		1,
		"herbivore.0",
		{ "herbivore.0": { stem: "rat", tier: 2 } },
		move(1, 0),
		[6, 4],
	],
	[
		"a stoat",
		1,
		"stoat",
		{ stoat: { stem: "stoat", tier: 0 } },
		move(1, 0),
		[6, 4],
	],
	[
		"cheese",
		2,
		"cheese",
		{ cheese: { stem: "cheese", tier: 0 } },
		move(1, 0),
		[6, 4],
	],
	[
		"a rat to the south",
		1,
		"rat",
		{ rat: { stem: "rat", tier: 0 } },
		move(0, 1),
		[5, 5],
	],
	[
		"a stoat to the south-east",
		1,
		"stoat",
		{ stoat: { stem: "stoat", tier: 0 } },
		move(1, 1),
		[6, 5],
	],
] as const)(
	"a queued move into %s sends %d commands in all",
	(_, count, species, looks, queued, [x, y]) => {
		const { sent } = run([
			...inFlightWith(queued),
			moved({ x: 5, y: 4 }, [[9, species, x, y]], looks),
			settled,
		]);
		expect(sent).toHaveLength(count);
	},
);

test.each([
	["rejected", message({ type: "rejected", reason: "invalid" })],
	["over", message({ type: "over" })],
	["lost", closed("1006")],
	["broken", fault("bug")],
])("%s clears the queue", (_, event) => {
	expect(run([...inFlightWith(east), event]).play.queued).toBeUndefined();
});

test("settling while a command is in flight keeps the queued gesture unsent", () => {
	const { play, sent } = run([...inFlightWith(wait), settled]);
	expect(sent).toHaveLength(1);
	expect(play.queued).toEqual(wait);
});

test("a snapshot after a reply reopens the turn: a gesture before it settles is queued, not sent", () => {
	const reply = run([opening, settled, gesture(east), moved({ x: 5, y: 4 })]);
	const early = run([gesture(wait)], reply.play);
	expect(early.sent).toEqual([]);
	expect(early.play.queued).toEqual(wait);
	expect(run([settled], early.play).sent).toEqual([{ type: "wait" }]);
});
