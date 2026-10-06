import { cheese } from "../../../../src/content/species/cheese";
import { rat } from "../../../../src/content/species/rat";
import { stoat } from "../../../../src/content/species/stoat";
import { LOD_PERIODS, PERCEPTION_RADIUS } from "../../../../src/core/config";
import {
	type AnyModule,
	defineModule,
	type EntityId,
} from "../../../../src/core/module/api";
import { createWorld } from "../../../../src/core/world/world";
import { fear } from "../../../../src/modules/fear";
import { MARGIN } from "../../../../src/modules/fear/config";
import { hunger } from "../../../../src/modules/hunger";
import { temperament } from "../../../../src/modules/temperament";
import { wander } from "../../../../src/modules/wander";
import { forwardBuilder, idleRounds } from "../../../fixtures";

// The player stands on floor 0, so the last floor decides every 64 turns.
export const FLOORS = LOD_PERIODS.length;
export const FAR = FLOORS - 1;
export const PERIOD = LOD_PERIODS[FAR] ?? 0;
export const ROUNDS = PERIOD + 8;
export const SIDE = 9;
export const player = { actor: true, components: {} };
export const SHY = 0;
export const BOLD = 255;
export const { min, max } = rat.components.temperament.boldness;
export const AVERAGE = (min + max) / 2;
// Below hunger's threshold, above fear's riskBelow.
export const HUNGRY = 400;
// Fear stamps danger this far from an eater: one cell beyond sight.
export const DANGER_REACH = PERCEPTION_RADIUS + MARGIN;

export let round = 0;
export const decided = new Map<EntityId, number[]>();
export const logger = defineModule({
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
export const still = [hunger, fear, logger];
export const roaming = [hunger, fear, wander, logger];

export const farFloor = (
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
export const scheduled = (id: number, rounds: number) =>
	[...Array(rounds).keys()].filter((r) => r === 0 || (r + id) % PERIOD === 0);
export const offSchedule = (id: number) => {
	const found = [...Array(PERIOD).keys()].find(
		(r) => r > 4 && (r + id) % PERIOD !== 0,
	);
	if (found === undefined) throw new Error(`no round off ${id}'s schedule`);
	return found;
};

export const ran = new Map<EntityId, [number, string][]>();
// Logs every run of the module's actions, cached replays included, by actor and round.
export const logged = (module: AnyModule): AnyModule => ({
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
export const actionsOf = (id: EntityId, at: number) =>
	(ran.get(id) ?? []).filter(([r]) => r === at).map(([, name]) => name);

export const STALK_SCORE = 30;
// Steps one cell along x every turn, above wander's score: a stoat that walks at its prey.
export const stalking = (dx: number) =>
	defineModule({
		name: "stalker",
		schema: { stalks: {} },
		config: { dx },
		setup(b, cfg) {
			const stalks = b.query(["stalks"]);
			const creep = b.action("creep", "none", ["stalks"], (ctx, actor) =>
				ctx.instead(ctx.step, ctx.cellAt(ctx.x(actor) + cfg.dx, ctx.y(actor))),
			);
			b.propose((_ctx, actor, _perception, out) => {
				if (stalks.has(actor)) out.push(creep, null, STALK_SCORE);
			});
		},
	});
export const stalker = stalking(-1);
export const walker = (x: number, y: number) => ({
	x,
	y,
	body: { ...stoat, components: { ...stoat.components, stalks: {} } },
});
export const block = { actor: true, components: {} };

export const distance = (
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

// Runs until the stoat stands within `radius` of the rat at a round start: by default, the round
// fear's danger first reaches the rat's cell, which alarms it.
export const untilWithin = (
	far: ReturnType<typeof farFloor>,
	prey: EntityId,
	hunter: EntityId,
	radius = DANGER_REACH,
) => {
	for (let r = 0; r < PERIOD; r++) {
		if (distance(far.world, prey, hunter) <= radius) return r;
		far.run(1);
	}
	throw new Error(`the stoat never came within ${radius}`);
};

// A hungry rat blocked from its cheese replays eat (it idles and keeps the intent) while a
// stoat walks at it from five cells east.
export const eatScene = (boldness: number) => {
	const far = farFloor([
		logged(hunger),
		temperament,
		logged(fear),
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
