import { expect, test } from "bun:test";
import { cheese } from "../../../src/content/species/cheese";
import { rat } from "../../../src/content/species/rat";
import { stoat } from "../../../src/content/species/stoat";
import { LOD_PERIODS, PERCEPTION_RADIUS } from "../../../src/core/config";
import {
	type AnyModule,
	defineModule,
	type EntityId,
} from "../../../src/core/module/api";
import { createWorld, loadWorld } from "../../../src/core/world/world";
import { fear } from "../../../src/modules/fear";
import { fearConfig } from "../../../src/modules/fear/config";
import { hunger } from "../../../src/modules/hunger";
import { temperament } from "../../../src/modules/temperament";
import { wander } from "../../../src/modules/wander";
import { climber } from "../../core/travel/climber";
import { forwardBuilder, idleRounds } from "../../fixtures";

// The player stands on floor 0, so the last floor decides every 64 turns.
const FLOORS = LOD_PERIODS.length;
const FAR = FLOORS - 1;
const PERIOD = LOD_PERIODS[FAR] ?? 0;
const ROUNDS = PERIOD + 8;
const SIDE = 9;
const player = { actor: true, components: {} };
const SHY = 0;
const BOLD = 255;
const { min, max } = rat.components.temperament.boldness;
const AVERAGE = (min + max) / 2;
// Below hunger's threshold, above fear's riskBelow.
const HUNGRY = 400;

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
	ran.clear();
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

const ran = new Map<EntityId, [number, string][]>();
// Logs every run of the module's actions, cached replays included, by actor and round.
const logged = (module: AnyModule): AnyModule => ({
	...module,
	setup(b, cfg) {
		module.setup(
			{
				...forwardBuilder(b),
				action: (name, kind, requires, run) =>
					b.action(name, kind, requires, (ctx, actor, target, perception) => {
						const id = ctx.idOf(actor);
						ran.set(id, [
							...(ran.get(id) ?? []),
							[round, `${module.name}/${name}`],
						]);
						return run(ctx, actor, target, perception);
					}),
			},
			cfg,
		);
	},
});
const actionsOf = (id: EntityId, at: number) =>
	(ran.get(id) ?? []).filter(([r]) => r === at).map(([, name]) => name);

// Steps one cell west every turn, above wander's score: a stoat that walks at its prey.
const STALK_SCORE = 30;
const stalker = defineModule({
	name: "stalker",
	schema: { stalks: {} },
	config: {},
	setup(b) {
		const stalks = b.query(["stalks"]);
		const creep = b.action("creep", "none", ["stalks"], (ctx, actor) =>
			ctx.instead(ctx.step, ctx.cellAt(ctx.x(actor) - 1, ctx.y(actor))),
		);
		b.propose((_ctx, actor, _perception, out) => {
			if (stalks.has(actor)) out.push(creep, null, STALK_SCORE);
		});
	},
});
const walker = (x: number, y: number) => ({
	x,
	y,
	body: { ...stoat, components: { ...stoat.components, stalks: {} } },
});
const block = { actor: true, components: {} };

const distance = (
	world: ReturnType<typeof farFloor>["world"],
	a: EntityId,
	b: EntityId,
) => {
	const p = world.locate(a);
	const q = world.locate(b);
	if (typeof p === "string" || typeof q === "string")
		throw new Error("not placed");
	return Math.max(Math.abs(p.x - q.x), Math.abs(p.y - q.y));
};

// Runs until the stoat stands within `radius` of the rat at a round start, which alarms its cell.
const untilWithin = (
	far: ReturnType<typeof farFloor>,
	prey: EntityId,
	hunter: EntityId,
	radius = fearConfig.alarmRadius,
) => {
	for (let r = 0; r < PERIOD; r++) {
		if (distance(far.world, prey, hunter) <= radius) return r;
		far.run(1);
	}
	throw new Error(`the stoat never came within ${radius}`);
};

// A hungry rat blocked from its cheese replays eat (it idles and keeps the intent) while a
// stoat walks at it from five cells east.
const eatScene = (fearModule: AnyModule, boldness: number) => {
	const far = farFloor([
		logged(hunger),
		temperament,
		logged(fearModule),
		stalker,
		logger,
	]);
	const { world } = far;
	world.spawn(FAR, cheese, 0, 4);
	for (let y = 3; y <= 5; y++) world.spawn(FAR, block, 1, y);
	const prey = world.spawn(FAR, rat, 2, 4, {
		temperament: { boldness },
		satiety: { value: HUNGRY },
	});
	const { x, y, body } = walker(7, 4);
	const hunter = world.spawn(FAR, body, x, y);
	return { far, world, prey, hunter };
};

test("a rat replaying eat on a P=64 floor decides in full on the turn a stoat comes within alarmRadius", () => {
	const { far, prey, hunter } = eatScene(fear, SHY);
	const woken = untilWithin(far, prey, hunter);
	expect(woken).toBeGreaterThan(0);
	expect(scheduled(prey, woken + 1)).toEqual([0]);
	far.run(1);
	expect(decided.get(prey)).toEqual([0, woken]);
	expect(actionsOf(prey, woken - 1)).toEqual(["hunger/eat"]);
	// One cell beyond sight by default: the wake sees no eater yet.
	expect(actionsOf(prey, woken)).toEqual(["hunger/eat"]);
});

test("with alarmRadius at sight, a rat replaying eat wakes as the stoat comes in sight and flees before it is adjacent", () => {
	const sighted = {
		...fear,
		config: { ...fearConfig, alarmRadius: PERCEPTION_RADIUS },
	};
	const { far, world, prey, hunter } = eatScene(sighted, SHY);
	const seen = untilWithin(far, prey, hunter, PERCEPTION_RADIUS);
	expect(seen).toBeGreaterThan(0);
	expect(scheduled(prey, seen + 1)).toEqual([0]);
	far.run(1);
	expect(decided.get(prey)).toEqual([0, seen]);
	expect(actionsOf(prey, seen - 1)).toEqual(["hunger/eat"]);
	expect(actionsOf(prey, seen)).toEqual(["fear/flee"]);
	expect(distance(world, prey, hunter)).toBeGreaterThan(1);
});

test("a rat replaying roam on a P=64 floor decides in full on the turn a stoat comes within alarmRadius", () => {
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

// Accepted limit: the alarm fires only on the turn an eater comes within alarmRadius.
test("a rat that keeps eating when a stoat comes within alarmRadius is not woken again as it closes", () => {
	// Bold and hungry: in sight, eating outscores watching, and it flees only at one cell.
	const { far, world, prey, hunter } = eatScene(fear, BOLD);
	const woken = untilWithin(far, prey, hunter);
	let adjacent = woken;
	for (; distance(world, prey, hunter) > 1; adjacent++) far.run(1);
	far.run(1);
	expect(scheduled(prey, adjacent + 1)).toEqual([0]);
	expect(decided.get(prey)).toEqual([0, woken]);
	expect(actionsOf(prey, woken)).toEqual(["hunger/eat"]);
	expect(actionsOf(prey, adjacent)).toEqual(["hunger/eat"]);
});

// Accepted limit: a cell already within alarmRadius of an eater raises no alarm for whoever steps into it.
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
