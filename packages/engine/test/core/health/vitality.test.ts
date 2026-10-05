import { expect, test } from "bun:test";
import { defineModule } from "../../../src/core/api";
import { createWorld } from "../../../src/core/world";

const world = () =>
	createWorld({ seed: 1, floors: 1, width: 4, height: 4, modules: [] });

for (const [what, vitality] of [
	["hp 0", { hp: 0, max: 5 }],
	["hp above max", { hp: 6, max: 5 }],
	["no values", {}],
	["a max past i16", { hp: 5, max: 40_000 }],
] as const)
	test(`spawning a species with ${what} of vitality throws`, () => {
		expect(() =>
			world().spawn(0, { actor: false, components: { vitality } }, 0, 0),
		).toThrow(/vitality/);
	});

test("a species gives vitality like any component", () => {
	const w = world();
	const id = w.spawn(
		0,
		{ actor: false, components: { vitality: { hp: 3, max: 7 } } },
		0,
		0,
	);
	expect([w.peek("vitality", "hp", id), w.peek("vitality", "max", id)]).toEqual(
		[3, 7],
	);
});

test("a module can neither own nor write vitality", () => {
	const owner = defineModule({
		name: "owner",
		schema: { vitality: { hp: "i16" } },
		config: {},
		setup() {},
	});
	expect(() =>
		createWorld({ seed: 1, floors: 1, width: 4, height: 4, modules: [owner] }),
	).toThrow(/vitality is owned by both core and owner/);
	const writer = defineModule({
		name: "writer",
		schema: {},
		config: {},
		setup(b) {
			b.write("vitality" as never);
		},
	});
	expect(() =>
		createWorld({ seed: 1, floors: 1, width: 4, height: 4, modules: [writer] }),
	).toThrow(/writer does not own vitality/);
});
