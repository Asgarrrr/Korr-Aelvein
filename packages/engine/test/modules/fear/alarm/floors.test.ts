import { expect, test } from "bun:test";
import { rat } from "../../../../src/content/species/rat";
import { stoat } from "../../../../src/content/species/stoat";
import { loadWorld } from "../../../../src/core/world/world";
import { fear } from "../../../../src/modules/fear";
import { hunger } from "../../../../src/modules/hunger";
import { climber } from "../../../core/travel/climber";
import {
	decided,
	FAR,
	FLOORS,
	farFloor,
	logger,
	offSchedule,
	PERIOD,
	ROUNDS,
	roaming,
	scheduled,
	still,
} from "./farScene";

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
