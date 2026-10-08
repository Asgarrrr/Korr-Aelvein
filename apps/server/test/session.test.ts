import { expect, test } from "bun:test";
import { starter } from "@korr/engine";
import type { Command, Entity, ServerMessage, Snapshot } from "@korr/protocol";
import { Session } from "../src/session";

const SEED = 7;
const OTHER_SEED = 8;
const STOAT_SEED = 21;
const WAIT: Command = { type: "wait" };
const OVER: ServerMessage = { type: "over" };
const MAX_STEPS = starter.width + starter.height;
const PLAYED_TURNS = 20;

type Point = { x: number; y: number };

// Row 0 would send the leftward move off the floor rather than wrap it to the row above.
const firstFreeInnerRow = () => {
	for (let row = 1; row < starter.height - 1; row++)
		if (starter.layout.every(({ y }) => y !== row)) return row;
	throw new Error("every inner row holds a layout entry");
};
const FREE_ROW = firstFreeInnerRow();

const snapshot = (message: ServerMessage): Snapshot => {
	if (message.type !== "snapshot")
		throw new Error(`expected a snapshot, got ${message.type}`);
	return message;
};

const player = (message: ServerMessage) => snapshot(message).player;

const at = ([, , x, y]: Entity): Point => ({ x, y });

const distance = (a: Point, b: Point) =>
	Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));

const nearestCheese = (message: ServerMessage) => {
	const { player, entities } = snapshot(message);
	const cheese = entities.filter(([, species]) => species === "cheese");
	cheese.sort((a, b) => distance(player, at(a)) - distance(player, at(b)));
	const nearest = cheese[0];
	if (!nearest) throw new Error("no cheese on the floor");
	return nearest;
};

const find = (message: ServerMessage, id: number) =>
	snapshot(message).entities.find(([other]) => other === id);

const move = (dx: number, dy: number): Command => ({ type: "move", dx, dy });

const walkTo = (session: Session, from: Snapshot, x: number, y: number) => {
	let last = from;
	for (let steps = 0; last.player.x !== x || last.player.y !== y; steps++) {
		if (steps === MAX_STEPS) throw new Error(`(${x}, ${y}) not reached`);
		const { player } = last;
		const step = move(Math.sign(x - player.x), Math.sign(y - player.y));
		last = snapshot(session.handle(step));
	}
	return last;
};

const expectStayed = (session: Session, command: Command, before: Snapshot) => {
	const { player, width, entities } = before;
	if (command.type === "move") {
		const cell = (player.y + command.dy) * width + (player.x + command.dx);
		const blockers = entities.filter(([, , x, y]) => y * width + x === cell);
		expect(blockers).toEqual([]);
	}
	const after = snapshot(session.handle(command));
	expect([after.player.x, after.player.y]).toEqual([player.x, player.y]);
	expect(after.player.satiety).toBeLessThan(player.satiety);
	return after;
};

const waitUntilOver = (session: Session) => {
	let last = snapshot(session.opening);
	// Each turn costs at least one satiety, so the opening satiety bounds the turns to starve.
	const bound = last.player.satiety;
	for (let turns = 0; turns < bound; turns++) {
		const message = session.handle(WAIT);
		if (message.type !== "snapshot") return { last, end: message };
		last = message;
	}
	throw new Error(`player alive after ${bound} turns`);
};

const expectRejectedOver = (session: Session) => {
	for (const command of [move(1, 0), WAIT])
		expect(session.handle(command)).toEqual({
			type: "rejected",
			reason: "over",
		});
};

test("the opening snapshot shows the floor and the player at the start cell", () => {
	const session = new Session(SEED);
	expect(session.opening).toEqual({
		type: "snapshot",
		width: starter.width,
		height: starter.height,
		player: {
			id: expect.any(Number),
			...starter.start,
			hp: expect.any(Number),
			satiety: expect.any(Number),
		},
		entities: expect.any(Array),
	});
	const opened = player(session.opening);
	expect(Number.isInteger(opened.id) && opened.id > 0).toBe(true);
	expect(opened.hp).toBeGreaterThan(0);
	expect(opened.satiety).toBeGreaterThan(0);
	expect(player(session.handle(WAIT)).id).toBe(opened.id);
});

test("the opening snapshot lists the starter layout, without the player", () => {
	const { player, entities } = snapshot(new Session(SEED).opening);
	expect(entities.map(([, species]) => species)).toEqual(
		starter.layout.map(({ species }) => species),
	);
	// Creatures take one turn before the player is first due, so each may be one step away.
	const moved = entities.map((entity, i) => {
		const home = starter.layout[i];
		if (!home) throw new Error(`entity ${i} is not in the layout`);
		return distance(at(entity), home);
	});
	expect(Math.max(...moved)).toBeLessThanOrEqual(1);
	expect(entities.map(([id]) => id)).not.toContain(player.id);
});

test("a move changes the position by (dx, dy)", () => {
	const session = new Session(SEED);
	const before = player(session.opening);
	const after = player(session.handle(move(1, -1)));
	expect([after.x, after.y]).toEqual([before.x + 1, before.y - 1]);
});

test("a wait keeps the position and plays the turn", () => {
	const session = new Session(SEED);
	expectStayed(session, WAIT, snapshot(session.opening));
});

test("a move off the floor keeps the position and plays the turn", () => {
	const session = new Session(SEED);
	let last = walkTo(session, snapshot(session.opening), 0, 0);
	last = expectStayed(session, move(-1, -1), last);
	last = expectStayed(session, move(0, -1), last);
	last = walkTo(session, last, starter.width - 1, starter.height - 1);
	expectStayed(session, move(1, 1), last);
});

test("a move that wraps to another row keeps the position and plays the turn", () => {
	const session = new Session(SEED);
	let last = walkTo(session, snapshot(session.opening), 0, FREE_ROW);
	last = expectStayed(session, move(-1, 0), last);
	last = walkTo(session, last, starter.width - 1, FREE_ROW);
	expectStayed(session, move(1, 0), last);
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
	expect(waitUntilOver(session).end).toEqual(OVER);
	expectRejectedOver(session);
});

test("a waiting player eaten by a stoat gets over before starving, then every command is rejected", () => {
	const session = new Session(STOAT_SEED);
	const opening = player(session.opening);
	const { last, end } = waitUntilOver(session);
	expect(end).toEqual(OVER);
	expect(last.player.satiety).toBeGreaterThan(opening.satiety >> 1);
	const stoats = last.entities.filter(([, species]) => species === "stoat");
	expect(stoats.some((stoat) => distance(at(stoat), last.player) === 1)).toBe(
		true,
	);
	expectRejectedOver(session);
});

test("a player next to cheese eats it: the cheese leaves the floor and satiety rises", () => {
	const session = new Session(SEED);
	const [cheese, , x, y] = nearestCheese(session.opening);
	const before = walkTo(session, snapshot(session.opening), x, y - 1);
	const after = session.handle({ type: "eat", target: cheese });
	expect(find(after, cheese)).toBeUndefined();
	expect(player(after).satiety).toBeGreaterThan(before.player.satiety);
});

test("an eat on cheese 3 or more cells away moves the player one step closer", () => {
	const session = new Session(SEED);
	// The starter layout puts the nearest cheese 3 cells from the start cell.
	const cheese = nearestCheese(session.opening);
	const far = distance(player(session.opening), at(cheese));
	expect(far).toBeGreaterThanOrEqual(3);
	const after = session.handle({ type: "eat", target: cheese[0] });
	expect(find(after, cheese[0])).toEqual(cheese);
	expect(distance(player(after), at(cheese))).toBe(far - 1);
});

test("the same seed and commands give the same messages, another seed differs", () => {
	const play = (seed: number) => {
		const session = new Session(seed);
		const messages = [session.opening];
		for (let turn = 0; turn < PLAYED_TURNS; turn++)
			messages.push(session.handle(turn % 2 ? WAIT : move(1, 0)));
		return messages;
	};
	expect(play(SEED)).toEqual(play(SEED));
	expect(play(OTHER_SEED)).not.toEqual(play(SEED));
});
