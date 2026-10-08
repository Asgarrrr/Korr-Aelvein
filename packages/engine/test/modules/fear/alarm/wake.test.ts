import { expect, test } from "bun:test";
import { ember } from "../../../../src/content/species/ember";
import { rat } from "../../../../src/content/species/rat";
import { stoat } from "../../../../src/content/species/stoat";
import { PERCEPTION_RADIUS } from "../../../../src/core/config";
import { fear } from "../../../../src/modules/fear";
import { fire } from "../../../../src/modules/fire";
import { hunger } from "../../../../src/modules/hunger";
import { temperament } from "../../../../src/modules/temperament";
import { wander } from "../../../../src/modules/wander";
import {
	AVERAGE,
	actionsOf,
	BOLD,
	block,
	decided,
	distance,
	eatScene,
	FAR,
	farFloor,
	logged,
	logger,
	offSchedule,
	ROUNDS,
	ran,
	SHY,
	SIDE,
	scheduled,
	stalker,
	stalking,
	untilWithin,
	walker,
} from "./farScene";

test("a rat replaying eat on a P=64 floor decides in full on the turn a stoat comes within reach of danger", () => {
	const { far, prey, hunter } = eatScene(SHY);
	const woken = untilWithin(far, prey, hunter);
	expect(woken).toBeGreaterThan(0);
	expect(scheduled(prey, woken + 1)).toEqual([0]);
	far.run(1);
	expect(decided.get(prey)).toEqual([0, woken]);
	expect(actionsOf(prey, woken - 1)).toEqual(["hunger/eat"]);
	// Danger reaches one cell beyond sight: the wake sees no eater yet.
	expect(actionsOf(prey, woken)).toEqual(["hunger/eat"]);
});

test("a rat replaying roam on a P=64 floor decides in full on the turn a stoat comes within reach of danger", () => {
	const far = farFloor([
		hunger,
		temperament,
		fear,
		logged(wander),
		stalker,
		logger,
	]);
	const { world } = far;
	// Boxed in, so every roam is a blocked step: it idles and keeps the intent. A rat that walks
	// into cells the stoat's square already covers is not woken (see the accepted limits below).
	for (const [bx, by] of [
		[0, 3],
		[1, 3],
		[1, 4],
		[1, 5],
		[0, 5],
	] as const)
		world.spawn(FAR, block, bx, by);
	const prey = world.spawn(FAR, rat, 0, 4, {
		temperament: { boldness: AVERAGE },
	});
	const { x, y, body } = walker(8, 4);
	const hunter = world.spawn(FAR, body, x, y);
	const woken = untilWithin(far, prey, hunter);
	expect(woken).toBeGreaterThan(0);
	expect(scheduled(prey, woken + 1)).toEqual([0]);
	far.run(1);
	expect(decided.get(prey)).toEqual([0, woken]);
	expect(actionsOf(prey, woken - 1)).toEqual(["wander/roam"]);
});

test("a rat replaying watch or flee in sight of a stoat pays no full decision for the alarm", () => {
	const watching = farFloor([hunger, temperament, fear, logger]);
	const watcher = watching.world.spawn(FAR, rat, 1, 1, {
		temperament: { boldness: AVERAGE },
	});
	// Three cells away, sated and still: the average rat watches and keeps watching.
	watching.world.spawn(FAR, stoat, 4, 1);
	watching.run(ROUNDS);
	expect(decided.get(watcher)).toEqual(scheduled(watcher, ROUNDS));

	const fleeing = farFloor([
		hunger,
		temperament,
		logged(fear),
		stalker,
		logger,
	]);
	const runner = fleeing.world.spawn(FAR, rat, 4, 4, {
		temperament: { boldness: SHY },
	});
	// Walks west as fast as the rat flees: the stoat stays in sight and the rat replays flee.
	const { x, y, body } = walker(6, 4);
	fleeing.world.spawn(FAR, body, x, y);
	const rounds = offSchedule(runner);
	fleeing.run(rounds);
	expect(decided.get(runner)).toEqual(scheduled(runner, rounds));
	expect(
		(ran.get(runner) ?? []).filter(([, name]) => name === "fear/flee"),
	).toHaveLength(rounds);
});

// Accepted limit: the alarm fires only on the turn danger first reaches the cell.
test("a rat that keeps eating when a stoat comes within reach of danger is not woken again as it closes", () => {
	// Bold and hungry: in sight, eating outscores watching, and it flees only at one cell.
	const { far, world, prey, hunter } = eatScene(BOLD);
	const woken = untilWithin(far, prey, hunter);
	let adjacent = woken;
	for (; distance(world, prey, hunter) > 1; adjacent++) far.run(1);
	far.run(1);
	expect(scheduled(prey, adjacent + 1)).toEqual([0]);
	expect(decided.get(prey)).toEqual([0, woken]);
	expect(actionsOf(prey, woken)).toEqual(["hunger/eat"]);
	expect(actionsOf(prey, adjacent)).toEqual(["hunger/eat"]);
});

// Accepted limit: a cell danger already covers raises no alarm for whoever steps into it.
test("a rat walking into a standing stoat's sight is not woken", () => {
	const far = farFloor([hunger, temperament, fear, stalker, logger]);
	const { world } = far;
	world.spawn(FAR, stoat, 1, 4);
	const prey = world.spawn(
		FAR,
		{ ...rat, components: { ...rat.components, stalks: {} } },
		7,
		4,
	);
	const rounds = 5;
	far.run(rounds);
	expect(world.locate(prey)).toEqual({ floor: FAR, x: 2, y: 4 });
	expect(scheduled(prey, rounds)).toEqual([0]);
	expect(decided.get(prey)).toEqual([0]);
});

// Rule 4a: avoid replays past the alarm, so it must end itself once an eater comes within flight.
test("a rat replaying avoid on a P=64 floor decides again and flees once an eater comes within flight", () => {
	const far = farFloor([
		hunger,
		fire,
		temperament,
		logged(fear),
		stalking(1),
		logger,
	]);
	const { world } = far;
	// Burning row 2 and a wall of actors on row 5: the rat avoids the fire by walking west.
	for (let x = 0; x < SIDE; x++) {
		world.spawn(FAR, ember, x, 2);
		world.spawn(FAR, block, x, 5);
	}
	const prey = world.spawn(FAR, rat, 7, 4, {
		temperament: { boldness: SHY },
	});
	const { body } = walker(0, 4);
	const hunter = world.spawn(FAR, body, 0, 4);
	const flight = untilWithin(far, prey, hunter, PERCEPTION_RADIUS);
	far.run(1);
	expect(scheduled(prey, flight + 1)).toEqual([0]);
	expect(actionsOf(prey, flight - 1)).toEqual(["fear/avoid"]);
	expect(decided.get(prey)).toEqual([0, flight]);
	expect(actionsOf(prey, flight)).toEqual(["fear/avoid", "fear/flee"]);
});
