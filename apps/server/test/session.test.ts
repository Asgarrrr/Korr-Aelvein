import { expect, test } from "bun:test";
import type { Command, ServerMessage, Snapshot } from "@korr/protocol";
import { FLOOR, Session, START } from "../src/session";

const SEED = 7;
const WAIT: Command = { type: "wait" };
const MIDDLE_ROW = FLOOR.height >> 1;
const MAX_STEPS = FLOOR.width + FLOOR.height;

type Player = Snapshot["player"];

const player = (message: ServerMessage): Player => {
	if (message.type !== "snapshot")
		throw new Error(`expected a snapshot, got ${message.type}`);
	return message.player;
};

const move = (dx: number, dy: number): Command => ({ type: "move", dx, dy });

const walkTo = (session: Session, from: Player, x: number, y: number) => {
	let at = from;
	for (let steps = 0; at.x !== x || at.y !== y; steps++) {
		if (steps === MAX_STEPS) throw new Error(`(${x}, ${y}) not reached`);
		at = player(session.handle(move(Math.sign(x - at.x), Math.sign(y - at.y))));
	}
	return at;
};

const expectStayed = (session: Session, command: Command, before: Player) => {
	const after = player(session.handle(command));
	expect([after.x, after.y]).toEqual([before.x, before.y]);
	expect(after.satiety).toBeLessThan(before.satiety);
	return after;
};

test("the opening snapshot shows the floor and the player at the start cell", () => {
	const session = new Session(SEED);
	expect(session.opening).toEqual({
		type: "snapshot",
		...FLOOR,
		player: {
			id: expect.any(Number),
			...START,
			hp: expect.any(Number),
			satiety: expect.any(Number),
		},
	});
	const opened = player(session.opening);
	expect(Number.isInteger(opened.id) && opened.id > 0).toBe(true);
	expect(opened.hp).toBeGreaterThan(0);
	expect(opened.satiety).toBeGreaterThan(0);
	expect(player(session.handle(WAIT)).id).toBe(opened.id);
});

test("a move changes the position by (dx, dy)", () => {
	const session = new Session(SEED);
	const before = player(session.opening);
	const after = player(session.handle(move(1, -1)));
	expect([after.x, after.y]).toEqual([before.x + 1, before.y - 1]);
});

test("a wait keeps the position and plays the turn", () => {
	const session = new Session(SEED);
	expectStayed(session, WAIT, player(session.opening));
});

test("a move off the floor keeps the position and plays the turn", () => {
	const session = new Session(SEED);
	let at = walkTo(session, player(session.opening), 0, 0);
	at = expectStayed(session, move(-1, -1), at);
	at = expectStayed(session, move(0, -1), at);
	at = walkTo(session, at, FLOOR.width - 1, FLOOR.height - 1);
	expectStayed(session, move(1, 1), at);
});

test("a move that wraps to another row keeps the position and plays the turn", () => {
	const session = new Session(SEED);
	let at = walkTo(session, player(session.opening), 0, MIDDLE_ROW);
	at = expectStayed(session, move(-1, 0), at);
	at = walkTo(session, at, FLOOR.width - 1, MIDDLE_ROW);
	expectStayed(session, move(1, 0), at);
});

test("a move of (0, 0) is rejected and plays no turn", () => {
	const session = new Session(SEED);
	expect(session.handle(move(0, 0))).toEqual({
		type: "rejected",
		reason: "invalid",
	});
	expect(session.handle(WAIT)).toEqual(new Session(SEED).handle(WAIT));
});

test("a player that only waits starves, then every command is rejected", () => {
	const session = new Session(SEED);
	let last = session.opening;
	// Each turn costs at least one satiety, so the opening satiety bounds the turns to starve.
	const bound = player(last).satiety;
	for (let turns = 0; last.type === "snapshot" && turns < bound; turns++)
		last = session.handle(WAIT);
	expect(last).toEqual({ type: "over" });
	for (const command of [move(1, 0), WAIT])
		expect(session.handle(command)).toEqual({
			type: "rejected",
			reason: "over",
		});
});
