import { expect, test } from "bun:test";
import { rat } from "../../../src/content/species/rat";
import { stoat } from "../../../src/content/species/stoat";
import type { AnyModule, EntityId } from "../../../src/core/module/api";
import type { World } from "../../../src/core/world/world";
import { temperament } from "../../../src/modules/temperament";
import { modules } from "../../../src/registry";
import { populatedWorld, SIZE } from "../../fixtures";

const COUNT = 50;
// Both ranges hold 121 values: 50 draws with more than half repeated would mean a degenerate draw.
const MIN_DISTINCT = COUNT / 2;

const boldness = (
	world: World<readonly AnyModule[]>,
	ids: readonly EntityId[],
) => ids.map((id) => world.peek("temperament", "boldness", id));

const expectWithin = (
	values: readonly number[],
	{ min, max }: { readonly min: number; readonly max: number },
) => {
	for (const v of values) {
		expect(v).toBeGreaterThanOrEqual(min);
		expect(v).toBeLessThanOrEqual(max);
	}
};

test.each([
	["rat", rat],
	["stoat", stoat],
] as const)(
	"%ss of one seed draw differing boldness within their range",
	(name, kind) => {
		const { world } = populatedWorld(1, modules, 0);
		const ids = Array.from({ length: COUNT }, (_, i) =>
			world.spawn(0, name, i % SIZE, 1 + Math.floor(i / SIZE)),
		);
		const values = boldness(world, ids);
		expectWithin(values, kind.components.temperament.boldness);
		expect(new Set(values).size).toBeGreaterThanOrEqual(MIN_DISTINCT);
	},
);

test("the game runs without temperament, and its rats carry no boldness", () => {
	const { world, rats } = populatedWorld(
		1,
		modules.filter((m) => m !== temperament),
	);
	for (let i = 0; i < 5; i++) world.spawn(0, "stoat", i * 6, 3);
	expect(() =>
		world.peek("temperament", "boldness", rats[0] as EntityId),
	).toThrow(/no temperament/);
	expect(() => world.runRounds(1000)).not.toThrow();
});
