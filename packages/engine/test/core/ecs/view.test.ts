import { expect, test } from "bun:test";
import { cheese } from "../../../src/content/species/cheese";
import { rat } from "../../../src/content/species/rat";
import { defineModule, type Slot } from "../../../src/core/api";
import { createWorld } from "../../../src/core/world";
import { hunger } from "../../../src/modules/hunger";

type DietView = ReturnType<typeof readDiet>;
let diet: DietView;
const readDiet = (b: Parameters<typeof spy.setup>[0]) => b.read("diet");
const spy = defineModule({
	name: "spy",
	schema: { seen: { eats: "u8" } },
	config: {},
	setup(b) {
		diet = readDiet(b);
		const seen = b.write("seen");
		const rows = b.query(["seen"]);
		b.tick((_ctx, floor) => {
			const list = rows.slots(floor);
			for (let i = 0; i < list.length; i++) {
				const s = list.at(i);
				seen.eats[s] = diet?.eats.get(s) ?? 0;
			}
		});
	},
});

const worldWith = (modules: readonly (typeof spy | typeof hunger)[]) =>
	createWorld({ seed: 1, floors: 1, width: 4, height: 4, modules });
const watched = <T extends { components: object }>(shape: T) => ({
	...shape,
	components: { ...shape.components, seen: {} },
});

test("a read view sees the owner's values", () => {
	const world = worldWith([hunger, spy]);
	const eater = world.spawn(0, watched(rat), 0, 0);
	const food = world.spawn(0, watched(cheese), 2, 2);
	world.runRounds(1);
	expect(world.peek("seen", "eats", eater)).toBe(rat.components.diet.eats);
	expect(world.peek("seen", "eats", food)).toBe(0);
});

test("reading a component no registered module owns gives undefined", () => {
	worldWith([spy]);
	expect(diet).toBeUndefined();
});

test("a read view holds no array a module could write through", () => {
	worldWith([hunger, spy]);
	const objects: object[] = [];
	const visit = (value: unknown) => {
		if (typeof value !== "object" || value === null) return;
		objects.push(value);
		for (const key of Reflect.ownKeys(value))
			visit((value as Record<PropertyKey, unknown>)[key]);
	};
	visit(diet);
	expect(objects.length).toBeGreaterThan(1);
	expect(objects.some((o) => ArrayBuffer.isView(o))).toBe(false);
	expect(diet?.eats.get(0 as Slot)).toBe(0);
});

test("reading a component the module owns throws", () => {
	const selfReader = defineModule({
		name: "self",
		schema: { diet: { eats: "u8" } },
		config: {},
		setup(b) {
			b.read("diet" as never);
		},
	});
	expect(() =>
		createWorld({
			seed: 1,
			floors: 1,
			width: 4,
			height: 4,
			modules: [selfReader],
		}),
	).toThrow(/owns diet/);
});
