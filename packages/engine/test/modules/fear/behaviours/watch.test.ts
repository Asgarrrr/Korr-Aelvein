import { expect, test } from "bun:test";
import { species } from "../../../../src/content/species";
import { cheese } from "../../../../src/content/species/cheese";
import { rat } from "../../../../src/content/species/rat";
import { stoat } from "../../../../src/content/species/stoat";
import { LOD_PERIODS } from "../../../../src/core/config";
import { spawn } from "../../../../src/core/lifecycle/lifecycle";
import {
	type ActionCtx,
	type ActionFn,
	ALTERNATE,
	type Builder,
	type ContractView,
	defineModule,
	type EntityId,
	FAIL,
	type Perception,
	type Slot,
} from "../../../../src/core/module/api";
import { createWorld } from "../../../../src/core/world/world";
import type { fear } from "../../../../src/modules/fear";
import { watchAction } from "../../../../src/modules/fear/behaviours/watch";
import { fearConfig } from "../../../../src/modules/fear/config";
import { foodClass } from "../../../../src/modules/hunger/config";
import { decider, decisions, idleRounds } from "../../../fixtures";
import { scene, still } from "../scene";

// Steps one cell east every turn, whatever it sees.
const stalker = defineModule({
	name: "stalker",
	schema: { stalks: {} },
	config: {},
	setup(b) {
		const creep = b.action("creep", "none", ["stalks"], (ctx, actor) =>
			ctx.instead(ctx.step, ctx.cellAt(ctx.x(actor) + 1, ctx.y(actor))),
		);
		b.propose((_ctx, _actor, _perception, out) => out.push(creep, null, 1));
	},
});
const STALKER = {
	actor: true,
	components: { stalks: {}, diet: { eats: foodClass.meat } },
};
const { min, max } = rat.components.temperament.boldness;
const AVERAGE = (min + max) / 2;
// A few turns of hunger's decay above riskBelow.
const RISK_MARGIN = 10;

test("a sated average rat watches an approaching eater at 3, then flees it at 2", () => {
	const { engine, intent, xOf, ratAt } = scene(16, [...still, stalker]);
	// Spawned first, so it acts first: 3 cells from the rat on its first turn, 2 on its second.
	spawn(engine, 0, STALKER, 6, 8);
	const id = ratAt(10, 8, AVERAGE);
	engine.runRound();
	expect([intent(id), xOf(id)]).toEqual(["fear/watch", 10]);
	engine.runRound();
	expect([intent(id), xOf(id)]).toEqual(["fear/flee", 11]);
});

test("a rat replaying watch on one eater decides again and flees when another comes within flight", () => {
	const world = createWorld({
		seed: 1,
		floors: 2,
		width: 16,
		height: 16,
		modules: [...still, stalker],
		species,
	});
	// The player on floor 0 puts floor 1 at P = 4: the rat replays its intent between decisions.
	world.spawnPlayer(0, { actor: true, components: {} }, 0, 0);
	const period = LOD_PERIODS[1] ?? 0;
	const hunter = world.spawn(1, STALKER, 2, 8);
	// Items shift the rat's id so it decides in full on round 0 and next on round `period`.
	for (let n = (period - ((hunter + 1) % period)) % period; n > 0; n--)
		world.spawn(1, { actor: false, components: {} }, 15, 15 - n);
	const id = world.spawn(1, rat, 8, 8, { temperament: { boldness: AVERAGE } });
	world.spawn(1, stoat, 11, 8);
	expect(id % period).toBe(0);
	const start = world.locate(id);
	// Rounds 0-2: watching the stoat, the stalker 5, 4 then 3 cells west.
	idleRounds(world, 3);
	expect(world.locate(id)).toEqual(start);
	// Round 3, a replay: the stalker steps within 2 cells, inside the rat's flight distance.
	idleRounds(world, 1);
	expect(world.locate(id)).not.toEqual(start);
});

// Slot 0 is the watcher; THREAT, in slot 1, the creature it watches.
const THREAT = 9 as EntityId;
const OTHER = 10 as EntityId;
const FLIGHT = 2;
const SIGHT = 3;
let hungry = false;
// What the watcher sees on the next run, as [slot, id, distance].
let inSight: [number, EntityId, number][] = [];
const watchWith = (eats: number[]) => {
	let run: ActionFn<"entity"> | undefined;
	const builder = {
		action: (
			_name: string,
			_kind: string,
			_requires: unknown,
			fn: ActionFn<"entity">,
		) => {
			run = fn;
			return { index: 0 };
		},
	} as unknown as Builder<typeof fear.schema, NonNullable<typeof fear.cells>>;
	const edible = {
		class: { get: (s: number) => (s === 0 ? foodClass.meat : 0) },
	} as unknown as ContractView<"edible">;
	const eater = (slot: number, prey: number) =>
		((eats[slot] ?? 0) & prey) !== 0;
	watchAction(builder, {
		edible,
		flightDistance: () => FLIGHT,
		starving: () => hungry,
		threatNear: (_ctx, _actor, prey, radius) =>
			inSight.some(([slot, , d]) => eater(slot, prey) && d <= radius),
		sees: (_ctx, _actor, threat, prey) =>
			inSight.some(
				([slot, id, d]) => id === threat && eater(slot, prey) && d <= SIGHT,
			),
	});
	return run as ActionFn<"entity">;
};
const ctx = { idle: {}, instead: () => ALTERNATE } as unknown as ActionCtx;
// Each seen entity as [slot, id, distance].
const sight = (...seen: [number, EntityId, number][]) => {
	inSight = seen;
	return {} as Perception;
};

test("watch idles while its threat is in sight beyond flight distance, and fails otherwise", () => {
	const run = watchWith([0, foodClass.meat, foodClass.meat, foodClass.forage]);
	const actor = 0 as Slot;
	const far = FLIGHT + 1;
	expect(run(ctx, actor, THREAT, sight([1, THREAT, far]))).toBe(ALTERNATE);
	expect(run(ctx, actor, THREAT, sight([1, THREAT, FLIGHT]))).toBe(FAIL);
	expect(run(ctx, actor, THREAT, sight())).toBe(FAIL);
	expect(run(ctx, actor, OTHER, sight([1, THREAT, far]))).toBe(FAIL);
	// Any eater of its class within flight distance, not only the threat it watches.
	expect(
		run(ctx, actor, THREAT, sight([2, OTHER, FLIGHT], [1, THREAT, far])),
	).toBe(FAIL);
	expect(
		run(ctx, actor, THREAT, sight([3, OTHER, FLIGHT], [1, THREAT, far])),
	).toBe(ALTERNATE);
	hungry = true;
	expect(run(ctx, actor, THREAT, sight([1, THREAT, far]))).toBe(FAIL);
	hungry = false;
	const harmless = watchWith([0, foodClass.forage]);
	expect(harmless(ctx, actor, THREAT, sight([1, THREAT, far]))).toBe(FAIL);
});

test("a rat watching on a P=64 floor decides again once its satiety drops below riskBelow, and eats", () => {
	const floors = LOD_PERIODS.length;
	const far = floors - 1;
	const period = LOD_PERIODS[far] ?? 0;
	decisions.clear();
	const world = createWorld({
		seed: 1,
		floors,
		width: 16,
		height: 16,
		modules: [...still, decider],
		species,
	});
	world.spawnPlayer(0, { actor: true, components: {} }, 0, 0);
	// Hungry but above riskBelow, with no food in sight: it watches the stoat three cells east.
	const id = world.spawn(far, rat, 8, 8, {
		temperament: { boldness: AVERAGE },
		satiety: { value: fearConfig.riskBelow + RISK_MARGIN },
	});
	world.spawn(far, stoat, 11, 8);
	idleRounds(world, 1);
	// Food in sight now raises no alarm: the cached watch goes on until hunger ends it.
	const meal = world.spawn(far, cheese, 6, 8);
	let round = 1;
	for (; decisions.get(id) === 1 && round < period; round++)
		idleRounds(world, 1);
	expect(round).toBeLessThan(period);
	expect((round - 1 + id) % period).not.toBe(0);
	expect(round - 1).toBeGreaterThan(1);
	idleRounds(world, 2);
	expect(world.locate(meal)).toBe("dead");
});
