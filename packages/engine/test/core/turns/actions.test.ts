import { expect, test } from "bun:test";
import {
	type ActionRef,
	ALTERNATE,
	type AnyModule,
	defineModule,
	FAIL,
	NO_CELL,
} from "../../../src/core/api";
import { ID_FLOOR_STRIDE, MAX_ALTERNATES } from "../../../src/core/config";
import { createWorld } from "../../../src/core/world";
import { probe } from "../../fixtures";

const TURN = 100;
const SCORE = 50;
const BODY = { actor: true, components: { trace: {}, where: {} } };

const worldWith = (...modules: AnyModule[]) =>
	createWorld({ seed: 1, floors: 1, width: 8, height: 8, modules });

const chain = (length: number, last: () => number) =>
	defineModule({
		name: "chain",
		schema: { trace: { depth: "u8", calls: "u8" } },
		config: {},
		setup(b) {
			const trace = b.write("trace");
			const refs: ActionRef<"none">[] = [];
			for (let i = 0; i < length; i++) {
				refs.push(
					b.action(`link${i}`, "none", (ctx, actor) => {
						trace.depth[actor] = i;
						trace.calls[actor] = (trace.calls[actor] ?? 0) + 1;
						const next = refs[i + 1];
						return next ? ctx.instead(next, null) : last();
					}),
				);
			}
			const first = refs[0];
			if (first)
				b.propose((_ctx, _actor, _p, out) => out.push(first, null, SCORE));
		},
	});

test("an alternate runs in place of the chosen action", () => {
	const world = worldWith(chain(3, () => TURN));
	const id = world.spawn(0, BODY, 0, 0);
	world.runRounds(1);
	expect(world.peek("trace", "depth", id)).toBe(2);
});

test("an alternate chain at the cap runs, one past it throws", () => {
	const atCap = worldWith(chain(MAX_ALTERNATES + 1, () => TURN));
	atCap.spawn(0, BODY, 0, 0);
	expect(() => atCap.runRounds(1)).not.toThrow();
	const past = worldWith(chain(MAX_ALTERNATES + 2, () => TURN));
	past.spawn(0, BODY, 0, 0);
	expect(() => past.runRounds(1)).toThrow(/alternates/);
});

test("ALTERNATE without ctx.instead throws", () => {
	const world = worldWith(chain(1, () => ALTERNATE));
	world.spawn(0, BODY, 0, 0);
	expect(() => world.runRounds(1)).toThrow(/instead/);
});

test("ALTERNATE without ctx.instead throws even after an earlier alternate", () => {
	const world = worldWith(chain(2, () => ALTERNATE));
	world.spawn(0, BODY, 0, 0);
	expect(() => world.runRounds(1)).toThrow(/instead/);
});

test("an alternate runs with the target given to ctx.instead", () => {
	const detour = defineModule({
		name: "detour",
		schema: { trace: { depth: "u8" } },
		config: {},
		setup(b) {
			const go = b.action("go", "none", (ctx, actor) =>
				ctx.instead(ctx.step, ctx.cellAt(ctx.x(actor) + 1, ctx.y(actor))),
			);
			b.propose((_c, _a, _p, out) => out.push(go, null, SCORE));
		},
	});
	const world = worldWith(detour, probe);
	const id = world.spawn(0, BODY, 3, 3);
	world.runRounds(2);
	expect(world.peek("where", "x", id)).toBe(4);
});

test("a cost below one tick or not an integer throws", () => {
	for (const cost of [0, 1.5]) {
		const world = worldWith(chain(1, () => cost));
		world.spawn(0, BODY, 0, 0);
		expect(() => world.runRounds(1)).toThrow(/cost/);
	}
});

test("a failed action idles for one turn", () => {
	const world = worldWith(chain(1, () => FAIL));
	const id = world.spawn(0, BODY, 0, 0);
	world.runRounds(3);
	expect(world.peek("trace", "calls", id)).toBe(3);
});

test("a non-integer score throws", () => {
	const world = worldWith(
		defineModule({
			name: "fuzzy",
			schema: { trace: { depth: "u8" } },
			config: {},
			setup(b) {
				b.propose((ctx, _a, _p, out) => out.push(ctx.idle, null, 1.5));
			},
		}),
	);
	world.spawn(0, BODY, 0, 0);
	expect(() => world.runRounds(1)).toThrow(/score/);
});

const stepper = (dx: number, dy: number) =>
	defineModule({
		name: "stepper",
		schema: { trace: { depth: "u8" } },
		config: {},
		setup(b) {
			b.propose((ctx, actor, _p, out) =>
				out.push(
					ctx.step,
					ctx.cellAt(ctx.x(actor) + dx, ctx.y(actor) + dy),
					SCORE,
				),
			);
		},
	});

test("a step must reach an adjacent cell", () => {
	const near = worldWith(stepper(1, 1), probe);
	const walker = near.spawn(0, BODY, 0, 0);
	near.runRounds(2);
	expect(near.peek("where", "x", walker)).toBe(1);

	const far = worldWith(stepper(2, 0), probe);
	const jumper = far.spawn(0, BODY, 0, 0);
	far.runRounds(2);
	expect(far.peek("where", "x", jumper)).toBe(0);
});

test("a fractional cell is rejected", () => {
	const world = worldWith(stepper(0.5, 0));
	world.spawn(0, BODY, 0, 0);
	expect(() => world.runRounds(1)).toThrow(/integer/);
});

test("an actor killed by its own action is not rescheduled", () => {
	const HALF_TURN = 50;
	const phoenix = defineModule({
		name: "phoenix",
		schema: { trace: { calls: "u8", reborn: "u8" } },
		config: {},
		setup(b) {
			const trace = b.write("trace");
			const ash = b.species({
				actor: true,
				components: { trace: { reborn: 1 } },
			});
			const burn = b.action("burn", "none", (ctx, actor) => {
				trace.calls[actor] = (trace.calls[actor] ?? 0) + 1;
				if (trace.reborn[actor] === 0) {
					const id = ctx.idOf(actor);
					ctx.kill(id, id);
					ctx.spawn(ash, ctx.x(actor), ctx.y(actor), id);
				}
				return HALF_TURN;
			});
			b.propose((_c, _a, _p, out) => out.push(burn, null, SCORE));
		},
	});
	const world = worldWith(phoenix);
	const first = world.spawn(0, BODY, 0, 0);
	world.runRounds(3);
	expect(world.alive(first)).toBe(false);
	// The newborn reuses the freed slot and first acts at 100: rounds 1 and 2, twice each.
	const reborn = (first + 1) as typeof first;
	expect(world.peek("trace", "calls", reborn)).toBe(4);
});

const named = (name: string, schema: Record<string, Record<string, "u8">>) =>
	defineModule({ name, schema, config: {}, setup() {} });

test("registration rejects duplicate names, owners and action keys", () => {
	expect(() => worldWith(named("a", {}), named("a", {}))).toThrow(
		/duplicate module name/,
	);
	expect(() => worldWith(named("core", {}))).toThrow(/duplicate module name/);
	expect(() =>
		worldWith(named("a", { c: { f: "u8" } }), named("b", { c: { f: "u8" } })),
	).toThrow(/owned by both/);
	const twice = defineModule({
		name: "twice",
		schema: {},
		config: {},
		setup(b) {
			b.action("go", "none", () => TURN);
			b.action("go", "none", () => TURN);
		},
	});
	expect(() => worldWith(twice)).toThrow(/duplicate action key/);
});

const napper = (kind: "cell" | "entity", target: number, viaInstead = false) =>
	defineModule({
		name: "rest",
		schema: {},
		config: {},
		setup(b) {
			const nap = b.action("nap", kind, () => TURN);
			const doze = b.action("doze", "none", (ctx) =>
				ctx.instead(nap, target as never),
			);
			b.propose((_ctx, _actor, _p, out) => {
				if (viaInstead) out.push(doze, null, SCORE);
				else out.push(nap, target as never, SCORE);
			});
		},
	});

for (const [what, kind, target, floors] of [
	["NO_CELL as a cell", "cell", NO_CELL, 1],
	["a cell past the floor", "cell", 64, 1],
	["entity 0", "entity", 0, 1],
	["an id whose counter is 0", "entity", ID_FLOOR_STRIDE, 2],
	["an id on a floor the world lacks", "entity", ID_FLOOR_STRIDE + 1, 1],
] as const)
	for (const viaInstead of [false, true])
		test(`targeting ${what}${viaInstead ? " through instead" : ""} throws before any save can hold it`, () => {
			const world = createWorld({
				seed: 1,
				floors,
				width: 8,
				height: 8,
				modules: [napper(kind, target, viaInstead)],
			});
			world.spawn(0, BODY, 0, 0);
			expect(() => world.runRounds(1)).toThrow(/rest\/nap .*target/);
			expect(() => world.save()).toThrow(/poisoned/);
		});
