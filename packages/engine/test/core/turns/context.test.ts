import { expect, test } from "bun:test";
import {
	type ActionRef,
	type Cell,
	defineModule,
	NO_CELL,
	type Slot,
} from "../../../src/core/api";
import { spawn } from "../../../src/core/lifecycle/lifecycle";
import { createEngine } from "../../../src/core/setup/registration";
import { execute } from "../../../src/core/turns/turn";
import { createWorld } from "../../../src/core/world";

const shape = (floors: number) => ({
	seed: 1,
	floors,
	width: 4,
	height: 4,
	popCap: 16,
	events: true,
});

test("holdsActor answers for the floor of the creature asking", () => {
	const seen: boolean[] = [];
	const looker = defineModule({
		name: "looker",
		schema: { eye: {} },
		config: {},
		setup(b) {
			const eyes = b.query(["eye"]);
			b.tick((ctx) => {
				if (eyes.slots(ctx).length > 0)
					seen.push(ctx.holdsActor(ctx.cellAt(0, 0)));
			});
		},
	});
	const engine = createEngine(shape(2), [looker]);
	spawn(engine, 0, { actor: true, components: {} }, 0, 0, 0);
	spawn(engine, 1, { actor: false, components: { eye: {} } }, 2, 2, 0);
	engine.runRound();
	expect(seen).toEqual([false]);
});

test("holdsActor is false off the floor edge and throws on a cell that is no cell", () => {
	const answers: boolean[] = [];
	let bad: unknown;
	const edge = defineModule({
		name: "edge",
		schema: {},
		config: {},
		setup(b) {
			b.propose((ctx, actor) => {
				answers.push(ctx.holdsActor(ctx.cellAt(ctx.x(actor) - 1, 0)));
				try {
					ctx.holdsActor(9999 as Cell);
				} catch (error) {
					bad = error;
				}
			});
		},
	});
	const world = createWorld({
		seed: 1,
		floors: 1,
		width: 4,
		height: 4,
		modules: [edge],
	});
	world.spawn(0, { actor: true, components: {} }, 0, 0);
	world.runRounds(1);
	expect(answers).toEqual([false]);
	expect(String(bad)).toMatch(/not on the floor/);
});

test("a step to the actor's own cell fails, so its decision is forgotten", () => {
	const still = defineModule({
		name: "still",
		schema: {},
		config: {},
		setup(b) {
			b.propose((ctx, actor, _p, out) =>
				out.push(ctx.step, ctx.cellAt(ctx.x(actor), ctx.y(actor)), 1),
			);
		},
	});
	const engine = createEngine(shape(1), [still]);
	const id = spawn(engine, 0, { actor: true, components: {} }, 1, 1, 0);
	const slot = engine.storage.slotOf(0, id) as Slot;
	engine.runRound();
	expect(engine.grid.x[slot]).toBe(1);
	expect(engine.intentKey[slot]).toBe(0);
});

test("an action sees perception as it is when the action runs", () => {
	const seen: number[] = [];
	let look: ActionRef<"none"> | undefined;
	const watcher = defineModule({
		name: "watcher",
		schema: {},
		config: {},
		setup(b) {
			look = b.action(
				"look",
				"none",
				[],
				(_ctx, _actor, _target, perception) => {
					seen.push(perception.count > 0 ? perception.dx(0) : 0);
					return 100;
				},
			);
			const action = look;
			b.propose((_ctx, _actor, perception, out) => {
				if (perception.count > 0) out.push(action, null, 1);
			});
		},
	});
	const engine = createEngine(shape(1), [watcher]);
	const actor = spawn(engine, 0, { actor: true, components: {} }, 0, 1, 0);
	spawn(engine, 0, { actor: false, components: {} }, 1, 1, 0);
	engine.runRound();
	const slot = engine.storage.slotOf(0, actor);
	engine.grid.move(0, slot, engine.grid.cellAt(3, 1));
	execute(engine, 0, slot, (look as ActionRef<"none">).index, 0);
	expect(seen).toEqual([1, -2]);
});

test("cellOf is the cell a creature stands on, wherever it has walked", () => {
	const seen: [Cell, Cell][] = [];
	const walker = defineModule({
		name: "walker",
		schema: {},
		config: {},
		setup(b) {
			const walk = b.action("walk", "none", [], (ctx, actor) => {
				seen.push([ctx.cellOf(actor), ctx.cellAt(ctx.x(actor), ctx.y(actor))]);
				const cell = ctx.cellAt(ctx.x(actor) + 1, ctx.y(actor) + 1);
				return cell === NO_CELL
					? ctx.instead(ctx.idle, null)
					: ctx.instead(ctx.step, cell);
			});
			b.propose((_ctx, _actor, _perception, out) => out.push(walk, null, 1));
		},
	});
	const world = createWorld({ ...shape(1), modules: [walker] });
	world.spawn(0, { actor: true, components: {} }, 0, 1);
	world.runRounds(4);
	expect(seen.map(([of]) => of as number)).toEqual([4, 9, 14, 14]);
	for (const [of, at] of seen) expect(of).toBe(at);
});
