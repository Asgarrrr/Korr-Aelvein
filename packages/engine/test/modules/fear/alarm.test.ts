import { expect, test } from "bun:test";
import { rat } from "../../../src/content/species/rat";
import { stoat } from "../../../src/content/species/stoat";
import { LOD_PERIODS } from "../../../src/core/config";
import {
	type AnyModule,
	defineModule,
	type EntityId,
} from "../../../src/core/module/api";
import { createWorld, loadWorld } from "../../../src/core/world/world";
import { fear } from "../../../src/modules/fear";
import { hunger } from "../../../src/modules/hunger";
import { wander } from "../../../src/modules/wander";
import { climber } from "../../core/travel/climber";
import { idleRounds } from "../../fixtures";

// The player stands on floor 0, so the last floor decides every 64 turns.
const FLOORS = LOD_PERIODS.length;
const FAR = FLOORS - 1;
const PERIOD = LOD_PERIODS[FAR] ?? 0;
const ROUNDS = PERIOD + 8;
const SIDE = 9;
const player = { actor: true, components: {} };

let round = 0;
const decided = new Map<EntityId, number[]>();
const logger = defineModule({
	name: "logger",
	schema: {},
	config: {},
	setup(b) {
		b.propose((ctx, actor) => {
			const id = ctx.idOf(actor);
			decided.set(id, [...(decided.get(id) ?? []), round]);
		});
	},
});
// Without wander nothing moves: every creature caches core/idle, which never fails.
const still = [hunger, fear, logger];
const roaming = [hunger, fear, wander, logger];

const farFloor = (
	modules: readonly AnyModule[],
	floorOrder?: readonly number[],
) => {
	round = 0;
	decided.clear();
	const world = createWorld({
		seed: 1,
		floors: FLOORS,
		width: SIDE,
		height: SIDE,
		modules,
		...(floorOrder ? { floorOrder } : {}),
	});
	world.spawnPlayer(0, player, 0, 0);
	const run = (rounds: number, on: typeof world = world) => {
		for (let r = 0; r < rounds; r++, round++) idleRounds(on, 1);
	};
	return { world, run };
};

// Round 0 and every P-th round after the id offset decide in full anyway.
const scheduled = (id: number, rounds: number) =>
	[...Array(rounds).keys()].filter((r) => r === 0 || (r + id) % PERIOD === 0);
const offSchedule = (id: number) => {
	const found = [...Array(PERIOD).keys()].find(
		(r) => r > 4 && (r + id) % PERIOD !== 0,
	);
	if (found === undefined) throw new Error(`no round off ${id}'s schedule`);
	return found;
};

test("a wary rat on a P=64 floor decides in full on the turn danger reaches its cell, then replays", () => {
	const { world, run } = farFloor(still);
	const prey = world.spawn(FAR, rat, 1, 1);
	const arrival = offSchedule(prey);
	run(arrival);
	expect(decided.get(prey)).toEqual(scheduled(prey, arrival));
	// Four cells away: inside fear's stamp (sight plus one cell of margin), out of sight.
	world.spawn(FAR, stoat, 5, 1);
	run(ROUNDS - arrival);
	expect(decided.get(prey)).toEqual(
		[...scheduled(prey, ROUNDS), arrival].sort((a, b) => a - b),
	);
});

test("a stoat whose cell danger reaches keeps replaying its cached decision", () => {
	const { world, run } = farFloor(still);
	const hunter = world.spawn(FAR, stoat, 1, 1);
	const arrival = offSchedule(hunter);
	run(arrival);
	// Fear stamps around eaters only once prey is on the floor, the stoat's own cell included.
	world.spawn(FAR, rat, 7, 7);
	run(ROUNDS - arrival);
	expect(decided.get(hunter)).toEqual(scheduled(hunter, ROUNDS));
});

const busy = (floorOrder?: readonly number[]) => {
	const far = farFloor(roaming, floorOrder);
	for (let f = 1; f < FLOORS; f++) {
		far.world.spawn(f, rat, 1, 1);
		far.world.spawn(f, rat, 6, 2);
		far.world.spawn(f, stoat, 4, 7);
	}
	return far;
};

test("floor order never changes the hash while alarms fire", () => {
	const hashOf = (order?: readonly number[]) => {
		const { world, run } = busy(order);
		run(ROUNDS);
		return world.hash();
	};
	const straight = hashOf();
	const order = [...Array(FLOORS).keys()];
	expect(hashOf([...order].reverse())).toBe(straight);
	expect(hashOf([2, 4, 0, 3, 1])).toBe(straight);
});

// The previous-turn danger is never saved: the tick copies it from the loaded cells.
test("save and load mid-run gives the same alarms as an unbroken run", () => {
	const unbroken = busy();
	unbroken.run(ROUNDS);
	const half = ROUNDS / 2;
	const { world, run } = busy();
	run(half);
	const loaded = loadWorld(world.save(), { modules: roaming });
	run(ROUNDS - half, loaded);
	expect(loaded.hash()).toBe(unbroken.world.hash());
});

test("a wary rat arriving by stairs where danger already stands decides in full once, then replays", () => {
	const { world, run } = farFloor([hunger, fear, climber, logger]);
	world.spawn(
		FAR - 1,
		{ actor: false, components: { link: { floor: FAR, x: 1, y: 1 } } },
		2,
		2,
	);
	const prey = world.spawn(
		FAR - 1,
		{ ...rat, components: { ...rat.components, climbs: {} } },
		1,
		1,
	);
	// Danger stands around (1, 1) from round 0: the stoat stamps it, out of sight, for a rat already there.
	world.spawn(FAR, stoat, 5, 1);
	world.spawn(FAR, rat, 8, 8);
	let arrival = 0;
	for (; arrival < PERIOD; arrival++) {
		run(1);
		const at = world.locate(prey);
		if (typeof at !== "string" && at.floor === FAR) break;
	}
	expect(arrival).toBeLessThan(PERIOD);
	run(ROUNDS - arrival - 1);
	// Travel never carries the intent, so the first turn on the new floor decides in full
	// whatever the alarm says; afterwards the cached choice replays until its schedule.
	expect(decided.get(prey)?.filter((r) => r >= arrival)).toEqual([
		arrival,
		...scheduled(prey, ROUNDS).filter((r) => r > arrival),
	]);
});

test("loading one floor mid-run into a live world with alarms firing changes nothing", () => {
	const straight = busy();
	const half = ROUNDS / 2;
	straight.run(half);
	const image = straight.world.saveFloor(FAR);
	straight.run(ROUNDS - half);
	const live = busy();
	live.run(half);
	// The live floor drifts from the image before the restore.
	live.world.spawn(FAR, { actor: false, components: {} }, 0, 0);
	live.world.loadFloor(FAR, image);
	live.run(ROUNDS - half);
	expect(live.world.hash()).toBe(straight.world.hash());
});
