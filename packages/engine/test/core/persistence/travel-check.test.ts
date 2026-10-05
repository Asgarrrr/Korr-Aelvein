import { expect, test } from "bun:test";
import { defineModule } from "../../../src/core/api";
import { CAP, EVENT_CAP_PER_TURN } from "../../../src/core/config";
import { ACTOR, ALIVE, PLAYER } from "../../../src/core/ecs/storage";
import { FLOOR_STAGE } from "../../../src/core/engine";
import { spawn } from "../../../src/core/lifecycle/lifecycle";
import { Checksum } from "../../../src/core/persistence/checksum";
import {
	engineDigest,
	hashHex,
	worldDigest,
} from "../../../src/core/persistence/hash";
import {
	COUNTER,
	EMITTED,
	FLOOR_HEADER,
	FREE_COUNT,
	HIGH_WATER,
	INBOX,
	imageChecksum,
	PERIOD,
	STAGE,
	SUM,
	saveFloor,
	sectionCount,
	TIME as TIME_WORD,
	TRAFFIC,
	WORD,
} from "../../../src/core/persistence/image";
import { readWorld, saveWorld } from "../../../src/core/persistence/save";
import { loadFloor } from "../../../src/core/persistence/validate";
import { createEngine } from "../../../src/core/setup/registration";
import { ENTRY_HEAD, ID, TIME, X } from "../../../src/core/travel/inbox";
import { createWorld, loadWorld } from "../../../src/core/world";

const SIDE = 8;
const TRAVELLERS = 3;

const climber = defineModule({
	name: "climber",
	schema: { climbs: {} },
	config: {},
	setup(b) {
		const stairs = b.query(["link"]);
		const climbers = b.query(["climbs"]);
		b.propose((ctx, actor, perception, out) => {
			if (!climbers.has(actor)) return;
			for (let i = 0; i < perception.count; i++)
				if (stairs.has(perception.slot(i)))
					out.push(ctx.travel, perception.id(i), 100);
		});
	},
});
const modules = [climber];
const body = { actor: true, components: { climbs: {} } };
const stairsTo = (floor: number, x: number, y: number) => ({
	actor: false,
	components: { link: { floor, x, y } },
});

const engineAt = (round: number) => {
	const engine = createEngine(
		{ seed: 1, floors: 2, width: SIDE, height: SIDE, popCap: 64, events: true },
		modules,
	);
	engine.round = round;
	// The source run posted into floor 1's inbox; this engine stands for that same run.
	engine.traffic[1] = new Int32Array(image.buffer)[TRAFFIC] ?? 0;
	return engine;
};

const hashOf = (engine: ReturnType<typeof engineAt>) => {
	engineDigest(engine);
	return hashHex(engine.digest);
};

const reseal = (bytes: Uint8Array) => {
	const words = new Int32Array(bytes.buffer);
	const sum = new Int32Array(2);
	imageChecksum(new Checksum(), words, sum);
	words[SUM] = sum[0] ?? 0;
	words[SUM + 1] = sum[1] ?? 0;
	return bytes;
};

// Floor 1's image after round 0, with three climbers on their way to it.
const source = createWorld({
	seed: 1,
	floors: 2,
	width: SIDE,
	height: SIDE,
	modules,
});
source.spawn(0, stairsTo(1, 4, 4), 3, 3);
const travellers = [
	source.spawn(0, body, 2, 2),
	source.spawn(0, body, 3, 2),
	source.spawn(0, body, 4, 3),
];
const staying = source.spawn(1, body, 6, 6);
source.runRounds(1);
const image = source.saveFloor(1);
const words = new Int32Array(image.buffer);
const target = engineAt(1);
const width = target.inbox.width;
let inboxAt = FLOOR_HEADER;
for (const section of target.sections)
	inboxAt += Math.ceil(
		(sectionCount(
			target,
			section,
			words[HIGH_WATER] ?? 0,
			words[FREE_COUNT] ?? 0,
		) *
			section.unit) /
			WORD,
	);

type Edit = (copy: Int32Array) => void;
const entry = (n: number, field: number) => inboxAt + n * width + field;

test("the floor image holds the travellers in (time, id) order", () => {
	expect(words[INBOX]).toBe(TRAVELLERS);
	expect(travellers.length).toBe(TRAVELLERS);
	expect([0, 1, 2].map((n) => words[entry(n, ID)])).toEqual(travellers);
	expect(() => loadFloor(engineAt(1), image.slice(), 1)).not.toThrow();
});

const cases: [string, Edit, RegExp][] = [
	[
		"entries out of order",
		(w) => {
			const first = w[entry(0, ID)] ?? 0;
			w[entry(0, ID)] = w[entry(1, ID)] ?? 0;
			w[entry(1, ID)] = first;
		},
		/out of \(time, id\) order/,
	],
	[
		"an entry arriving at -1",
		(w) => {
			w[entry(0, TIME)] = -1;
		},
		/arrives at -1/,
	],
	[
		"an entry with id 0",
		(w) => {
			w[entry(0, ID)] = 0;
		},
		/bad or repeated id/,
	],
	[
		"an entry off the floor",
		(w) => {
			w[entry(2, X)] = SIDE;
		},
		/off the floor/,
	],
	[
		"an entry that does not act",
		(w) => {
			w[entry(1, ENTRY_HEAD)] = 1;
		},
		/not a living actor/,
	],
	[
		"an entry also on the floor",
		(w) => {
			w[entry(2, ID)] = staying;
		},
		/both on the floor and in its inbox/,
	],
	[
		"an entry repeating an earlier id",
		(w) => {
			w[entry(2, TIME)] = (w[entry(2, TIME)] ?? 0) + 1;
			w[entry(2, ID)] = w[entry(0, ID)] ?? 0;
		},
		/bad or repeated id/,
	],
	[
		"an entry carrying a link",
		(w) => {
			const at = entry(1, ENTRY_HEAD + target.link.word);
			w[at] = (w[at] ?? 0) | target.link.bit;
		},
		/actor with a link/,
	],
	[
		"an entry with vitality but no hp",
		(w) => {
			const at = entry(1, ENTRY_HEAD + target.vitality.word);
			w[at] = (w[at] ?? 0) | target.vitality.bit;
		},
		/hp 0 of 0/,
	],
	[
		"a decision period on a floor waiting for its round",
		(w) => {
			w[PERIOD] = 4;
		},
		/do not fit/,
	],
	[
		"a finished floor whose clock is short of the round's end",
		(w) => {
			w[STAGE] = FLOOR_STAGE.done;
			w[PERIOD] = 1;
		},
		/do not fit/,
	],
	[
		"an entry keeping a value in a component it lacks",
		(w) => {
			const hp = target.carried.indexOf(target.vitality.hp);
			w[entry(1, ENTRY_HEAD + target.storage.maskWords + hp)] = 5;
		},
		/keeps a value in vitality/,
	],
	[
		"a negative event count",
		(w) => {
			w[EMITTED] = -1;
		},
		/events this turn/,
	],
	[
		"an event count past the cap",
		(w) => {
			w[EMITTED] = EVENT_CAP_PER_TURN + 1;
		},
		/events this turn/,
	],
	[
		"an id counter below an id the floor issued",
		(w) => {
			w[COUNTER] = 0;
		},
		/not one this floor issued/,
	],
];

for (const [name, edit, error] of cases)
	test(`a floor image with ${name} throws`, () => {
		const copy = image.slice();
		edit(new Int32Array(copy.buffer));
		expect(() => loadFloor(engineAt(1), reseal(copy), 1)).toThrow(error);
	});

test("stairs leading to their own floor, off the floor or on an actor never load", () => {
	const make = (to: number, x: number, actor: boolean) => {
		const e = engineAt(0);
		const id = spawn(e, 0, stairsTo(1, 1, 1), 2, 2, 0);
		const slot = e.storage.slotOf(0, id);
		e.link.floor[slot] = to;
		e.link.x[slot] = x;
		const at = slot * e.storage.maskWords;
		if (actor) e.storage.masks[at] = (e.storage.masks[at] ?? 0) | ACTOR;
		return saveFloor(e, 0);
	};
	expect(() => loadFloor(engineAt(0), make(1, 1, false), 0)).not.toThrow();
	for (const bad of [
		make(0, 1, false),
		make(2, 1, false),
		make(1, SIDE, false),
		make(1, 1, true),
	])
		expect(() => loadFloor(engineAt(0), bad, 0)).toThrow(/leads nowhere/);
});

test("a player bit on a creature that does not act never loads", () => {
	const e = engineAt(0);
	const id = spawn(e, 0, { actor: false, components: {} }, 2, 2, 0);
	const at = e.storage.slotOf(0, id) * e.storage.maskWords;
	e.storage.masks[at] = (e.storage.masks[at] ?? 0) | PLAYER;
	expect(() => loadFloor(engineAt(0), saveFloor(e, 0), 0)).toThrow(
		/player but does not act/,
	);
});

test("a save whose floors disagree on whether the round started never loads", () => {
	const world = createWorld({
		seed: 1,
		floors: 2,
		width: SIDE,
		height: SIDE,
		modules,
	});
	world.spawnPlayer(0, body, 1, 1);
	expect(world.advance().length).toBe(1);
	const bytes = world.save();
	const { header, images } = readWorld(bytes);
	// Floor 1 finished round 0; rewrite it as if the round had not reached it.
	const floor1 = images[1] as Uint8Array;
	const head = new Int32Array(floor1.buffer, floor1.byteOffset, FLOOR_HEADER);
	expect(head[STAGE]).toBe(FLOOR_STAGE.done);
	head[STAGE] = FLOOR_STAGE.waiting;
	head[PERIOD] = 0;
	head[TIME_WORD] = 0;
	const view = new Int32Array(
		floor1.buffer,
		floor1.byteOffset,
		floor1.length / WORD,
	);
	imageChecksum(new Checksum(), view, head.subarray(SUM, SUM + 2));
	const sums = new Int32Array(4);
	images.forEach((floor, f) => {
		const words = new Int32Array(floor.buffer, floor.byteOffset, FLOOR_HEADER);
		sums[2 * f] = words[SUM] ?? 0;
		sums[2 * f + 1] = words[SUM + 1] ?? 0;
	});
	const all = new Int32Array(bytes.buffer);
	worldDigest(new Checksum(), header, header.events, sums, all.subarray(1, 3));
	expect(() => loadWorld(bytes, { modules })).toThrow(/started the round/);
});

// Red's shape: a full floor keeps refusing arrivals while the others keep sending, so its inbox
// outgrows every per-floor bound. Only the image's own length bounds the count.
test("an inbox holding more entries than the whole world has slots saves and loads", () => {
	const crowded = engineAt(0);
	const waiting = crowded.storage.floors * CAP + 1;
	crowded.storage.counters[0] = waiting;
	for (let id = 1; id <= waiting; id++) {
		const at = crowded.inbox.insert(1, 100, id, 1, 1);
		crowded.inbox.words(1)[at + ENTRY_HEAD] = ALIVE | ACTOR;
	}
	const loaded = loadWorld(saveWorld(crowded), { modules });
	expect(loaded.hash()).toBe(hashOf(crowded));
});

test("an inbox count the image cannot hold throws before anything is read", () => {
	const copy = image.slice();
	new Int32Array(copy.buffer)[INBOX] = 0x7fffffff;
	expect(() => loadFloor(engineAt(1), reseal(copy), 1)).toThrow(
		/inbox entries/,
	);
});
