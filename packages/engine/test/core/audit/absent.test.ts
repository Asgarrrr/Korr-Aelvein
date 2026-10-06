import { expect, test } from "bun:test";
import { CAP } from "../../../src/core/config";
import { defineModule } from "../../../src/core/module/api";
import { createWorld } from "../../../src/core/world/world";

const TURN = 100;

// Writes its own component on every row it touches, whether the row has it or not.
const tag = (phase: "tick" | "action") =>
	defineModule({
		name: "tag",
		schema: { mark: { n: "u8" } },
		config: {},
		setup(b) {
			const mark = b.write("mark");
			const all = b.query([]);
			b.action("stamp", "none", [], (_ctx, actor) => {
				mark.n[actor] = 1;
				return TURN;
			});
			b.tick((ctx) => {
				const list = all.slots(ctx);
				if (phase === "tick")
					for (let i = 0; i < list.length; i++) mark.n[list.at(i)] = 1;
			});
		},
	});

for (const phase of ["tick", "action"] as const)
	test(`${phase}: writing its own component on a row without it throws in audit mode, naming it`, () => {
		const run = (audit: boolean) => {
			const world = createWorld({
				seed: 1,
				floors: 1,
				width: 4,
				height: 4,
				modules: [tag(phase)],
				audit,
			});
			world.spawn(0, { actor: false, components: { mark: {} } }, 0, 0);
			const bare = world.spawnPlayer(0, { actor: true, components: {} }, 1, 1);
			for (let due = world.advance(); due.length > 0; due = world.advance())
				world.input(bare, "tag/stamp", null);
		};
		expect(() => run(false)).not.toThrow();
		expect(() => run(true)).toThrow(
			/tag wrote mark\.n at slot 1, a row without mark/,
		);
	});

test("audit names the exact slot of a write to a component in a later mask word, on floor 1", () => {
	const fillers = Object.fromEntries(
		Array.from({ length: 33 }, (_, i) => [`f${i}`, {}]),
	);
	const wide = defineModule({
		name: "wide",
		schema: { ...fillers, late: { a: "u8", b: "u8" } },
		config: {},
		setup(b) {
			const late = b.write("late");
			const all = b.query([]);
			b.tick((ctx) => {
				const list = all.slots(ctx);
				for (let i = 0; i < list.length; i++) late.b[list.at(i)] = 1;
			});
		},
	});
	const world = createWorld({
		seed: 1,
		floors: 2,
		width: 4,
		height: 4,
		modules: [wide],
		audit: true,
	});
	world.spawn(1, { actor: false, components: { late: {} } }, 0, 0);
	world.spawn(1, { actor: false, components: {} }, 1, 0);
	expect(() => world.runRounds(1)).toThrow(
		new RegExp(`wide wrote late\\.b at slot ${CAP + 1}, a row without late`),
	);
});
