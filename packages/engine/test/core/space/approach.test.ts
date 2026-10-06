import { expect, test } from "bun:test";
import { type Cell, defineModule, NO_CELL } from "../../../src/core/module/api";
import { createWorld } from "../../../src/core/world/world";

const SIDE = 8;
const at = (x: number, y: number) => (y * SIDE + x) as Cell;

// Records, on its first proposal, the step `approach` picks toward the goal.
const stepToward = (
	from: [number, number],
	goal: [number, number],
	blocked: readonly [number, number][],
	item?: [number, number],
): Cell => {
	let picked: Cell | undefined;
	const aimer = defineModule({
		name: "aimer",
		schema: { aim: {} },
		config: {},
		setup(b) {
			const aiming = b.query(["aim"]);
			b.propose((ctx, actor) => {
				if (aiming.has(actor) && picked === undefined)
					picked = ctx.approach(actor, goal[0], goal[1]);
			});
		},
	});
	const world = createWorld({
		seed: 1,
		floors: 1,
		width: SIDE,
		height: SIDE,
		modules: [aimer],
	});
	world.spawn(0, { actor: true, components: { aim: {} } }, ...from);
	for (const [x, y] of blocked)
		world.spawn(0, { actor: true, components: {} }, x, y);
	if (item) world.spawn(0, { actor: false, components: {} }, ...item);
	world.runRounds(1);
	return picked as Cell;
};

test("approach takes the straight step when it is free", () => {
	expect(stepToward([2, 2], [5, 4], [])).toBe(at(3, 3));
});

test("an entity that is not an actor does not block the straight step", () => {
	expect(stepToward([2, 2], [5, 2], [], [3, 2])).toBe(at(3, 2));
});

test("with the straight step taken, approach takes the first closing neighbour in fixed order", () => {
	expect(stepToward([2, 2], [5, 2], [[3, 2]])).toBe(at(3, 1));
	expect(
		stepToward(
			[2, 2],
			[5, 2],
			[
				[3, 2],
				[3, 1],
			],
		),
	).toBe(at(3, 3));
});

test("a free neighbour that does not close the distance is never taken", () => {
	expect(
		stepToward(
			[2, 2],
			[5, 2],
			[
				[3, 1],
				[3, 2],
				[3, 3],
			],
		),
	).toBe(NO_CELL);
});

// (0, 3) would close in too: a straight step off the grid ends the search.
test("toward a target off the grid, a straight step off the edge gives NO_CELL", () => {
	expect(stepToward([0, 2], [-1, 5], [])).toBe(NO_CELL);
});
