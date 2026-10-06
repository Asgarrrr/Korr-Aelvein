import { expect, test } from "bun:test";
import { type AnyModule, defineModule } from "../../../src/core/api";
import { SCORE_MAX } from "../../../src/core/config";
import { hashName } from "../../../src/core/random/rng";
import { createWorld } from "../../../src/core/world";
import { probe } from "../../fixtures";

const SCORE = 50;
const TURN = 100;

const marker = (name: string, score = SCORE) =>
	defineModule({
		name,
		schema: { [`${name}Hit`]: { count: "u8" } },
		config: {},
		setup(b) {
			const hit = b.write(`${name}Hit`);
			const mark = b.action("mark", "none", [`${name}Hit`], (_ctx, actor) => {
				hit.count[actor] = (hit.count[actor] ?? 0) + 1;
				return TURN;
			});
			b.propose((_ctx, _actor, _perception, out) =>
				out.push(mark, null, score),
			);
		},
	});

const hitsOf = (modules: readonly AnyModule[]) => {
	const world = createWorld({
		seed: 1,
		floors: 1,
		width: 4,
		height: 4,
		modules,
	});
	const id = world.spawn(
		0,
		{ actor: true, components: { alphaHit: {}, betaHit: {} } },
		0,
		0,
	);
	world.runRounds(1);
	return {
		alpha: world.peek("alphaHit", "count", id),
		beta: world.peek("betaHit", "count", id),
	};
};

test("equal scores pick the lower action key, whatever the registry order", () => {
	const alpha = marker("alpha");
	const beta = marker("beta");
	const alphaWins = hashName("alpha/mark") < hashName("beta/mark");
	const expected = { alpha: alphaWins ? 1 : 0, beta: alphaWins ? 0 : 1 };
	expect(hitsOf([alpha, beta])).toEqual(expected);
	expect(hitsOf([beta, alpha])).toEqual(expected);
});

test("scores clamp to [0, SCORE_MAX] before comparing", () => {
	const alphaLower = hashName("alpha/mark") < hashName("beta/mark");
	const tie = { alpha: alphaLower ? 1 : 0, beta: alphaLower ? 0 : 1 };
	const [low, high] = alphaLower ? ["alpha", "beta"] : ["beta", "alpha"];
	expect(
		hitsOf([
			marker(low as string, SCORE_MAX),
			marker(high as string, SCORE_MAX + 1),
		]),
	).toEqual(tie);
	expect(
		hitsOf([marker(low as string, -1), marker(high as string, 0)]),
	).toEqual(tie);
});

test("equal scores on one action pick the lower target", () => {
	const sway = defineModule({
		name: "sway",
		schema: {},
		config: {},
		setup(b) {
			b.propose((ctx, actor, _p, out) => {
				const x = ctx.x(actor);
				const y = ctx.y(actor);
				out.push(ctx.step, ctx.cellAt(x + 1, y), SCORE);
				out.push(ctx.step, ctx.cellAt(x - 1, y), SCORE);
			});
		},
	});
	const world = createWorld({
		seed: 1,
		floors: 1,
		width: 8,
		height: 8,
		modules: [sway, probe],
	});
	const id = world.spawn(0, { actor: true, components: { where: {} } }, 4, 4);
	world.runRounds(2);
	expect(world.peek("where", "x", id)).toBe(3);
});
