import { afterAll, expect, test } from "bun:test";
import type { Command, ServerMessage } from "@korr/protocol";
import { createApp } from "../src/app";
import { Session } from "../src/session";
import { connect } from "./client";

const SEED = 7;
const OTHER_SEED = 8;
const INTERNAL_ERROR = 1011;
const INVALID: ServerMessage = { type: "rejected", reason: "invalid" };
const WAIT: Command = { type: "wait" };
const RIGHT: Command = { type: "move", dx: 1, dy: 0 };
const BAD_INPUTS: [string, unknown][] = [
	["a delta out of range", { type: "move", dx: 2, dy: 0 }],
	["an extra key", { type: "wait", extra: 1 }],
	["an eat target of 0", { type: "eat", target: 0 }],
	["an eat target as a string", { type: "eat", target: "1" }],
	["an eat target past i32", { type: "eat", target: 2 ** 31 }],
	["plain text", "not json"],
	["broken JSON", "{not json"],
];

const player = (message: ServerMessage) => {
	if (message.type !== "snapshot")
		throw new Error(`expected a snapshot, got ${message.type}`);
	return message.player;
};

const isPending = (promise: Promise<unknown>) => Bun.peek(promise) === promise;

class BrokenSession extends Session {
	override handle(): ServerMessage {
		throw new Error("broken session");
	}
}

const fixedSeedApp = createApp({ seed: SEED }).listen(0);
const seeds = [SEED, OTHER_SEED];
const perConnectionSeedApp = createApp({
	createSession: () => new Session(seeds.shift() ?? SEED),
}).listen(0);
const brokenApp = createApp({
	seed: SEED,
	createSession: (seed) => new BrokenSession(seed),
}).listen(0);
afterAll(() => {
	fixedSeedApp.stop(true);
	perConnectionSeedApp.stop(true);
	brokenApp.stop(true);
});

test("sends the opening snapshot on open", async () => {
	const client = await connect(fixedSeedApp.server?.port);
	expect(await client.next()).toEqual(new Session(SEED).opening);
	client.close();
});

test("replies to each command with the session's snapshot", async () => {
	const client = await connect(fixedSeedApp.server?.port);
	await client.next();
	const session = new Session(SEED);
	expect(await client.send(RIGHT)).toEqual(session.handle(RIGHT));
	expect(await client.send(WAIT)).toEqual(session.handle(WAIT));
	client.close();
});

test.each(BAD_INPUTS)(
	"rejects invalid messages and keeps the game playable: %s",
	async (_reason, raw) => {
		const client = await connect(fixedSeedApp.server?.port);
		await client.next();
		expect(await client.send(raw)).toEqual(INVALID);
		expect(await client.send(WAIT)).toEqual(new Session(SEED).handle(WAIT));
		client.close();
	},
);

test("closes with 1011 and sends no reply when the session throws", async () => {
	const client = await connect(brokenApp.server?.port);
	await client.next();
	const reply = client.send(WAIT);
	expect(await client.closed).toBe(INTERNAL_ERROR);
	expect(isPending(reply)).toBe(true);
});

test("keeps connections independent", async () => {
	const first = await connect(perConnectionSeedApp.server?.port);
	const second = await connect(perConnectionSeedApp.server?.port);
	const before = player(await second.next());
	await first.next();
	expect(player(await first.send(RIGHT)).x).toBe(before.x + 1);
	const after = player(await second.send(WAIT));
	expect([after.x, after.y]).toEqual([before.x, before.y]);
	first.close();
	second.close();
});
