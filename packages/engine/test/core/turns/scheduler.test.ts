import { expect, test } from "bun:test";
import { MAX_TICK, TICKS_PER_TURN } from "../../../src/core/config";
import { ACTOR, Storage } from "../../../src/core/ecs/storage";
import { spawn } from "../../../src/core/lifecycle/lifecycle";
import { NONE, type Slot } from "../../../src/core/module/api";
import { createEngine } from "../../../src/core/setup/registration";
import { Scheduler } from "../../../src/core/turns/scheduler";

const ACTORS = 48;
const ROUNDS = 40;
const STEP = 0x9e3779b1;

// A deterministic stream of small numbers for the scenario.
const stream = (seed: number) => {
	let s = seed;
	return (bound: number) => {
		s = (Math.imul(s ^ (s >>> 15), STEP) + 0x6d2b79f5) | 0;
		return (s >>> 8) % bound;
	};
};

const actor = (storage: Storage, floor = 0) => {
	const slot = storage.alloc(floor);
	const word = slot * storage.maskWords;
	storage.masks[word] = (storage.masks[word] ?? 0) | ACTOR;
	return slot;
};

// The order every scheduler must follow: the lowest (nextAt, id) of the queued actors.
const naiveTop = (
	queued: Set<Slot>,
	scheduler: Scheduler,
	storage: Storage,
	end: number,
): Slot => {
	let best = NONE as Slot;
	for (const s of queued) {
		const t = scheduler.nextAt[s] ?? 0;
		if (t >= end) continue;
		const b = scheduler.nextAt[best] ?? 0;
		if (
			best === NONE ||
			t < b ||
			(t === b && (storage.ids[s] ?? 0) < (storage.ids[best] ?? 0))
		)
			best = s;
	}
	return best;
};

for (const seed of [1, 2, 3, 4])
	test(`turns run in (nextAt, id) order through rounds, re-entries, deaths and births (seed ${seed})`, () => {
		const next = stream(seed);
		const storage = new Storage(1, 0);
		const scheduler = new Scheduler(storage);
		const queued = new Set<Slot>();
		const add = (at: number) => {
			const slot = actor(storage);
			scheduler.nextAt[slot] = at;
			scheduler.push(0, slot);
			queued.add(slot);
		};
		const kill = (slot: Slot) => {
			scheduler.remove(0, slot);
			queued.delete(slot);
			storage.release(0, slot);
		};
		for (let i = 0; i < ACTORS; i++) add(next(2 * TICKS_PER_TURN));
		let turns = 0;
		for (let round = 0; round < ROUNDS; round++) {
			const end = (round + 1) * TICKS_PER_TURN;
			scheduler.open(0, end);
			for (;;) {
				const expected = naiveTop(queued, scheduler, storage, end);
				const time =
					expected === NONE ? end : (scheduler.nextAt[expected] ?? 0);
				expect(scheduler.topTime(0) < end).toBe(expected !== NONE);
				if (expected === NONE) break;
				expect(scheduler.top(0)).toBe(expected);
				turns++;
				const roll = next(20);
				// Recycled slots take new, higher ids: slot order stops matching id order.
				if (roll === 0) kill(expected);
				else if (roll === 1) add(time + 1 + next(TICKS_PER_TURN));
				else {
					const cost =
						roll < 6
							? 1 + next(TICKS_PER_TURN / 2)
							: roll < 18
								? TICKS_PER_TURN
								: 1 + next(5 * TICKS_PER_TURN);
					scheduler.delay(0, expected, time + cost);
				}
				if (next(25) === 0) {
					const victims = [...queued].filter((s) => s !== expected);
					const victim = victims[next(victims.length)];
					if (victim !== undefined) kill(victim);
				}
				expect(scheduler.size(0)).toBe(queued.size);
			}
		}
		expect(turns).toBeGreaterThan(ACTORS * ROUNDS * 0.5);
	});

test("a slot reborn with the time its dead actor was due at runs once", () => {
	const storage = new Storage(1, 0);
	const scheduler = new Scheduler(storage);
	const first = actor(storage);
	scheduler.nextAt[first] = TICKS_PER_TURN;
	scheduler.push(0, first);
	scheduler.remove(0, first);
	storage.release(0, first);
	const second = actor(storage);
	expect(second).toBe(first);
	scheduler.nextAt[second] = TICKS_PER_TURN;
	scheduler.push(0, second);
	scheduler.open(0, 2 * TICKS_PER_TURN);
	expect(scheduler.top(0)).toBe(second);
	scheduler.delay(0, second, 3 * TICKS_PER_TURN);
	expect(scheduler.topTime(0)).toBeGreaterThanOrEqual(2 * TICKS_PER_TURN);
	expect(scheduler.size(0)).toBe(1);
});

test("a scheduler rebuilt mid-round resumes at the lowest (nextAt, id) of that round", () => {
	const storage = new Storage(2, 0);
	const scheduler = new Scheduler(storage);
	const slots = [0, 1, 2, 3].map(() => actor(storage, 1));
	const times = [250, 230, 230, 410];
	slots.forEach((s, i) => {
		scheduler.nextAt[s] = times[i] ?? 0;
	});
	scheduler.rebuild(1, 3 * TICKS_PER_TURN);
	expect(scheduler.size(1)).toBe(4);
	expect(scheduler.top(1)).toBe(slots[1] as Slot);
	scheduler.delay(1, slots[1] as Slot, 330);
	expect(scheduler.top(1)).toBe(slots[2] as Slot);
	scheduler.delay(1, slots[2] as Slot, 260);
	expect(scheduler.top(1)).toBe(slots[0] as Slot);
	scheduler.delay(1, slots[0] as Slot, 350);
	expect(scheduler.top(1)).toBe(slots[2] as Slot);
	scheduler.delay(1, slots[2] as Slot, 360);
	expect(scheduler.topTime(1)).toBeGreaterThanOrEqual(3 * TICKS_PER_TURN);
	expect(scheduler.size(0)).toBe(0);
});

test("a round that would end past MAX_TICK refuses to start", () => {
	const engine = createEngine(
		{ seed: 1, floors: 1, width: 4, height: 4, popCap: 4, events: true },
		[],
	);
	spawn(engine, 0, { actor: true, components: {} }, 0, 0);
	const last = Math.floor(MAX_TICK / TICKS_PER_TURN) - 1;
	engine.round = last;
	engine.runRound();
	expect(() => engine.runRound()).toThrow(/MAX_TICK/);
});
