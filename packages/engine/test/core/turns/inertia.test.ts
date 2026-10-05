import { expect, test } from "bun:test";
import { species } from "../../../src/content/species";
import { cheese } from "../../../src/content/species/cheese";
import { rat } from "../../../src/content/species/rat";
import {
	type ActionRef,
	defineModule,
	type EntityId,
	FAIL,
} from "../../../src/core/api";
import { SCORE_MAX } from "../../../src/core/config";
import { spawn } from "../../../src/core/lifecycle/lifecycle";
import { hashName } from "../../../src/core/random/rng";
import { createEngine } from "../../../src/core/setup/registration";
import { createWorld, loadWorld } from "../../../src/core/world";
import { hungerConfig } from "../../../src/modules/hunger/config";
import { modules } from "../../../src/registry";

const SCORE = 50;
const TURN = 100;
const [LOW, HIGH] = ["a", "b"].sort(
	(x, y) => hashName(`fickle/${x}`) - hashName(`fickle/${y}`),
) as [string, string];

// First turn: only the higher-keyed action. Later turns: both, at one score, so the
// key tie-break alone would pick the lower one.
const fickle = (highResult = TURN, score = SCORE) =>
	defineModule({
		name: "fickle",
		schema: { tally: { low: "u8", high: "u8" } },
		config: {},
		setup(b) {
			const tally = b.write("tally");
			const low = b.action(LOW, "none", (_ctx, actor) => {
				tally.low[actor] = (tally.low[actor] ?? 0) + 1;
				return TURN;
			});
			const high = b.action(HIGH, "none", (_ctx, actor) => {
				tally.high[actor] = (tally.high[actor] ?? 0) + 1;
				return highResult;
			});
			b.propose((_ctx, actor, _p, out) => {
				if ((tally.low[actor] ?? 0) + (tally.high[actor] ?? 0) > 0)
					out.push(low, null, score);
				out.push(high, null, score);
			});
		},
	});

// First turn: only the highest id in view. Later: every one, at one score.
const poker = defineModule({
	name: "poker",
	schema: { pokes: { last: "entity", n: "u8" } },
	config: {},
	setup(b) {
		const pokes = b.write("pokes");
		const poke = b.action("poke", "entity", (_ctx, actor, target) => {
			pokes.last[actor] = target;
			pokes.n[actor] = (pokes.n[actor] ?? 0) + 1;
			return TURN;
		});
		b.propose((_ctx, actor, perception, out) => {
			const first = (pokes.n[actor] ?? 0) === 0;
			let top = 0;
			for (let i = 0; i < perception.count; i++)
				if (perception.id(i) > top) top = perception.id(i);
			for (let i = 0; i < perception.count; i++)
				if (!first || perception.id(i) === top)
					out.push(poke, perception.id(i), SCORE);
		});
	},
});

const options = { seed: 1, floors: 1, width: 4, height: 4 } as const;
const BODY = { actor: true, components: { tally: {} } };

test("of two equal candidates, the one matching the last decision wins", () => {
	const world = createWorld({ ...options, modules: [fickle()] });
	const id = world.spawn(0, BODY, 0, 0);
	world.runRounds(3);
	expect(world.peek("tally", "low", id)).toBe(0);
	expect(world.peek("tally", "high", id)).toBe(3);
});

test("inertia lifts a candidate above SCORE_MAX: the clamp does not swallow it", () => {
	const world = createWorld({ ...options, modules: [fickle(TURN, SCORE_MAX)] });
	const id = world.spawn(0, BODY, 0, 0);
	world.runRounds(3);
	expect(world.peek("tally", "high", id)).toBe(3);
});

test("a failed decision is forgotten: it gets no inertia next turn", () => {
	const world = createWorld({ ...options, modules: [fickle(FAIL)] });
	const id = world.spawn(0, BODY, 0, 0);
	world.runRounds(3);
	expect(world.peek("tally", "high", id)).toBe(1);
	expect(world.peek("tally", "low", id)).toBe(2);
});

const pokerWorld = () => {
	const world = createWorld({ ...options, modules: [poker] });
	const id = world.spawn(0, { actor: true, components: { pokes: {} } }, 1, 1);
	const near = world.spawn(0, { actor: false, components: {} }, 0, 1);
	const far = world.spawn(0, { actor: false, components: {} }, 2, 1);
	expect(far).toBeGreaterThan(near);
	return { world, id, far };
};

test("only the candidate with the last decision's target gets inertia", () => {
	const { world, id, far } = pokerWorld();
	world.runRounds(3);
	expect(world.peek("pokes", "last", id)).toBe(far);
});

test("the last decision and its entity target survive save and load", () => {
	const { world, id, far } = pokerWorld();
	world.runRounds(1);
	const bytes = world.save();
	const loaded = loadWorld(bytes, { modules: [poker] });
	expect(loaded.save()).toEqual(bytes);
	loaded.runRounds(2);
	expect(loaded.peek("pokes", "n", id)).toBe(3);
	expect(loaded.peek("pokes", "last", id)).toBe(far);
});

test("the decision kept is the chosen action, not the alternate it ran", () => {
	const detour = defineModule({
		name: "fickle",
		schema: { tally: { low: "u8", high: "u8" } },
		config: {},
		setup(b) {
			const tally = b.write("tally");
			let low: ActionRef<"none"> | undefined;
			const high = b.action(HIGH, "none", (ctx, actor) => {
				tally.high[actor] = (tally.high[actor] ?? 0) + 1;
				return low ? ctx.instead(low, null) : TURN;
			});
			low = b.action(LOW, "none", (_ctx, actor) => {
				tally.low[actor] = (tally.low[actor] ?? 0) + 1;
				return TURN;
			});
			const first = low;
			b.propose((_ctx, actor, _p, out) => {
				if ((tally.high[actor] ?? 0) > 0) out.push(first, null, SCORE);
				out.push(high, null, SCORE);
			});
		},
	});
	const world = createWorld({ ...options, modules: [detour] });
	const id = world.spawn(0, BODY, 0, 0);
	world.runRounds(3);
	expect(world.peek("tally", "high", id)).toBe(3);
});

test("walking to food keeps one decision, eat on that food, at every step", () => {
	const engine = createEngine(
		{ seed: 1, floors: 1, width: 16, height: 16, popCap: 64, events: true },
		modules,
		species,
	);
	const hungry = {
		...rat,
		components: {
			...rat.components,
			satiety: { value: hungerConfig.hungryBelow - 100 },
		},
	};
	const eater = spawn(engine, 0, hungry, 2, 2, 0);
	const food = spawn(engine, 0, cheese, 5, 2, 0) as EntityId;
	const slot = engine.storage.slotOf(0, eater);
	const eat = hashName("hunger/eat") | 0;
	const seen: [number, number, number][] = [];
	for (let round = 0; round < 2; round++) {
		engine.runRound();
		seen.push([
			engine.grid.x[slot] ?? 0,
			engine.intentKey[slot] ?? 0,
			engine.intentTarget[slot] ?? 0,
		]);
	}
	expect(seen).toEqual([
		[3, eat, food],
		[4, eat, food],
	]);
});
