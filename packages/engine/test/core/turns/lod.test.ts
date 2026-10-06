import { expect, test } from "bun:test";
import {
	type AnyModule,
	defineModule,
	type EntityId,
	FAIL,
} from "../../../src/core/api";
import { LOD_PERIODS } from "../../../src/core/config";
import type { Engine } from "../../../src/core/engine";
import { spawn } from "../../../src/core/lifecycle/lifecycle";
import { hashName } from "../../../src/core/random/rng";
import { createEngine } from "../../../src/core/setup/registration";
import { advance, playerTurn } from "../../../src/core/turns/round";
import { createWorld, loadWorld } from "../../../src/core/world";

const TURN = 100;
const ROUNDS = 64;

let round = 0;
let failing = new Set<number>();
const decided = new Map<number, number[]>();
const attempts = new Map<number, number[]>();
const log = (into: Map<number, number[]>, id: number) => {
	const list = into.get(id) ?? [];
	list.push(round);
	into.set(id, list);
};
const thinker = defineModule({
	name: "thinker",
	schema: { thinks: {} },
	config: {},
	setup(b) {
		const thinkers = b.query(["thinks"]);
		const think = b.action("think", "none", [], (ctx, actor) => {
			log(attempts, ctx.idOf(actor));
			return failing.has(round) ? FAIL : TURN;
		});
		b.propose((ctx, actor, _p, out) => {
			if (!thinkers.has(actor)) return;
			log(decided, ctx.idOf(actor));
			out.push(think, null, 100);
		});
	},
});
const body = { actor: true, components: { thinks: {} } };
const player = { actor: true, components: {} };

const reset = (fails: number[] = []) => {
	round = 0;
	failing = new Set(fails);
	decided.clear();
	attempts.clear();
};

const world = (floors: number, alone = false) => {
	reset();
	const w = createWorld({
		seed: 1,
		floors,
		width: 4,
		height: 4,
		modules: [thinker],
	});
	const ids: EntityId[] = [];
	for (let f = 0; f < floors; f++) ids.push(w.spawn(f, body, 1, 1));
	if (!alone) w.spawnPlayer(0, player, 3, 3);
	const run = (rounds: number) => {
		for (let r = 0; r < rounds; r++, round++)
			for (let due = w.advance(); due.length > 0; due = w.advance())
				for (const p of due) w.input(p, "core/idle", null);
	};
	return { w, ids, run };
};

// Arbitrates on its first turn (no cached decision), then whenever (round + id) mod P is 0.
const expectedRounds = (id: number, period: number) =>
	[...Array(ROUNDS).keys()].filter((r) => r === 0 || (r + id) % period === 0);

test("with a player on floor 0, each floor decides in full every P turns and repeats its cached decision otherwise", () => {
	const { ids, run } = world(6);
	run(ROUNDS);
	ids.forEach((id, floor) => {
		const period = LOD_PERIODS[Math.min(floor, LOD_PERIODS.length - 1)] ?? 0;
		expect(decided.get(id)).toEqual(expectedRounds(id, period));
		expect(attempts.get(id)?.length).toBe(ROUNDS);
	});
	expect(decided.get(ids[3] ?? 0)?.length).toBeLessThan(ROUNDS / 8);
});

test("with no player anywhere, every floor decides every turn", () => {
	const { ids, run } = world(6, true);
	run(ROUNDS);
	for (const id of ids) expect(decided.get(id)?.length).toBe(ROUNDS);
});

test("a FAIL on re-execution decides at once; a second FAIL idles the turn", () => {
	const { ids, run } = world(4);
	const id = ids[3] ?? 0;
	const quiet = [...Array(ROUNDS).keys()].find(
		(r) => r > 0 && (r + id) % 16 !== 0 && (r + 1 + id) % 16 !== 0,
	) as number;
	failing = new Set([quiet]);
	run(ROUNDS);
	const at = (list: number[] | undefined, r: number) =>
		(list ?? []).filter((x) => x === r).length;
	expect(at(attempts.get(id), quiet)).toBe(2);
	expect(at(decided.get(id), quiet)).toBe(1);
	// The failed turn cleared the decision, so the next turn decides afresh.
	expect(at(decided.get(id), quiet + 1)).toBe(1);
	expect(at(decided.get(id), quiet + 2)).toBe(0);
});

const engineWorld = () => {
	reset();
	const e = createEngine(
		{ seed: 1, floors: 4, width: 4, height: 4, popCap: 16, events: true },
		[thinker],
	);
	const id = spawn(e, 3, body, 1, 1);
	spawn(e, 0, player, 3, 3, true);
	const run = (rounds: number) => {
		for (let r = 0; r < rounds; r++, round++)
			for (let due = advance(e); due.length > 0; due = advance(e))
				for (const p of due) {
					const f = e.storage.floorOf(p);
					playerTurn(e, f, e.storage.slotOf(f, p), e.idleIndex, 0);
				}
	};
	return { e, id, run, slot: () => e.storage.slotOf(3, id) };
};

const firstQuiet = (id: number) =>
	[...Array(ROUNDS).keys()].find((r) => r > 1 && (r + id) % 16 !== 0) as number;

for (const [what, corrupt] of [
	[
		"an unknown action key",
		(e: Engine, s: number) => {
			e.intentKey[s] = 12345;
		},
	],
	[
		"a target its action cannot take",
		(e: Engine, s: number) => {
			e.intentKey[s] = hashName("core/step") | 0;
			e.intentTarget[s] = -7;
		},
	],
] as const)
	test(`a cached decision with ${what} means no decision: the actor decides in full`, () => {
		const { e, id, run, slot } = engineWorld();
		const quiet = firstQuiet(id);
		run(quiet);
		corrupt(e, slot());
		run(1);
		expect(decided.get(id)).toContain(quiet);
		expect(attempts.get(id)?.length).toBe(quiet + 1);
	});

// Thinkers on floors 0 and 3, the player on floor 0 beside stairs to floor 3.
const moving = (extra: AnyModule[] = []) => {
	reset();
	const w = createWorld({
		seed: 1,
		floors: 4,
		width: 4,
		height: 4,
		modules: [thinker, ...extra],
	});
	const near = w.spawn(0, body, 1, 1);
	const far = w.spawn(3, body, 1, 1);
	const stairs = w.spawn(
		0,
		{ actor: false, components: { link: { floor: 3, x: 0, y: 0 } } },
		3,
		2,
	);
	const self = w.spawnPlayer(0, player, 3, 3);
	const run = (rounds: number, travelAt = -1) => {
		for (let r = 0; r < rounds; r++, round++)
			for (let due = w.advance(); due.length > 0; due = w.advance())
				for (const p of due)
					if (round === travelAt) w.input(p, "core/travel", stairs);
					else w.input(p, "core/idle", null);
	};
	return { w, near, far, self, run };
};

const since = (list: number[] | undefined, from: number) =>
	(list ?? []).filter((r) => r >= from);
const every = (from: number, id: number, period: number) =>
	[...Array(ROUNDS).keys()].filter(
		(r) => r >= from && (period === 1 || (r + id) % period === 0),
	);

test("a player who takes the stairs moves the near floors with it, already while in transit", () => {
	const { near, far, run } = moving();
	const leave = 10;
	run(ROUNDS, leave);
	// From the round after it left, the player counts for floor 3: in transit, then standing there.
	const settled = leave + 1;
	expect(since(decided.get(far), settled)).toEqual(every(settled, far, 1));
	expect(since(decided.get(near), settled)).toEqual(every(settled, near, 16));
	expect(decided.get(far)?.filter((r) => r < leave).length).toBeLessThan(leave);
});

test("when the last player dies, every floor decides every turn again", () => {
	let victim = 0 as EntityId;
	const killAt = 10;
	const reaper = defineModule({
		name: "reaper",
		schema: {},
		config: {},
		setup(b) {
			b.tick((ctx) => {
				if (round === killAt && ctx.isAlive(victim)) ctx.kill(victim, victim);
			});
		},
	});
	const { far, self, run } = moving([reaper]);
	victim = self;
	run(ROUNDS);
	expect(since(decided.get(far), killAt + 1)).toEqual(
		every(killAt + 1, far, 1),
	);
	expect(decided.get(far)?.filter((r) => r < killAt).length).toBeLessThan(
		killAt,
	);
});

test("the nearest of several players sets a floor's period", () => {
	reset();
	const w = createWorld({
		seed: 1,
		floors: 6,
		width: 4,
		height: 4,
		modules: [thinker],
	});
	const id = w.spawn(1, body, 1, 1);
	w.spawnPlayer(0, player, 3, 3);
	w.spawnPlayer(5, player, 3, 3);
	for (; round < ROUNDS; round++)
		for (let due = w.advance(); due.length > 0; due = w.advance())
			for (const p of due) w.input(p, "core/idle", null);
	expect(decided.get(id)).toEqual(expectedRounds(id, LOD_PERIODS[1] ?? 0));
});

test("a loaded world keeps every floor's period", () => {
	const { w, ids, run } = world(4);
	run(20);
	const loaded = loadWorld(w.save(), { modules: [thinker] });
	for (; round < ROUNDS; round++)
		for (let due = loaded.advance(); due.length > 0; due = loaded.advance())
			for (const p of due) loaded.input(p, "core/idle", null);
	const far = ids[3] ?? 0;
	expect(decided.get(far)).toEqual(expectedRounds(far, LOD_PERIODS[3] ?? 0));
});

test("a loaded world counts a player in transit for its destination", () => {
	const { w, near, far, run } = moving();
	const leave = 10;
	run(leave + 1, leave);
	const loaded = loadWorld(w.save(), { modules: [thinker] });
	for (; round < ROUNDS; round++)
		for (let due = loaded.advance(); due.length > 0; due = loaded.advance())
			for (const p of due) loaded.input(p, "core/idle", null);
	expect(since(decided.get(far), leave + 1)).toEqual(every(leave + 1, far, 1));
	expect(since(decided.get(near), leave + 1)).toEqual(
		every(leave + 1, near, 16),
	);
});

test("a cached decision that fails gets no inertia in the decision that replaces it", () => {
	let now = 0;
	let failAt = -1;
	const bRounds: number[] = [];
	const flaky = defineModule({
		name: "flaky",
		schema: { flake: {} },
		config: {},
		setup(b) {
			const rows = b.query(["flake"]);
			const first = b.action("first", "none", [], () =>
				now === failAt ? FAIL : TURN,
			);
			const second = b.action("second", "none", [], () => {
				bRounds.push(now);
				return TURN;
			});
			let seen = false;
			b.propose((_ctx, actor, _p, out) => {
				if (!rows.has(actor)) return;
				out.push(first, null, 100);
				// Within INERTIA of the first: only a kept decision on the first outbids it.
				if (seen) out.push(second, null, 103);
				seen = true;
			});
		},
	});
	const w = createWorld({
		seed: 1,
		floors: 4,
		width: 4,
		height: 4,
		modules: [flaky],
	});
	const id = w.spawn(3, { actor: true, components: { flake: {} } }, 1, 1);
	w.spawnPlayer(0, player, 3, 3);
	failAt = [...Array(ROUNDS).keys()].find(
		(r) => r > 1 && (r + id) % 16 !== 0,
	) as number;
	for (; now < ROUNDS; now++)
		for (let due = w.advance(); due.length > 0; due = w.advance())
			for (const p of due) w.input(p, "core/idle", null);
	expect(bRounds[0]).toBe(failAt);
});
