import { expect, test } from "bun:test";
import { CAP } from "../../../src/core/config";
import { defineModule, type EntityId } from "../../../src/core/module/api";
import { createWorld } from "../../../src/core/world/world";

const tagged = (v: number) => ({ actor: false, components: { tag: { v } } });

// On its first tick: kills entity 1, then emits spawns with descending causes.
const crowd = (causes: readonly number[]) => {
	let fired = false;
	return defineModule({
		name: "crowd",
		schema: { tag: { v: "u8" } },
		config: {},
		setup(b) {
			const refs = causes.map((cause) => b.species(tagged(cause)));
			b.tick((ctx) => {
				if (fired) return;
				fired = true;
				ctx.kill(1 as EntityId, 1 as EntityId);
				causes.forEach((cause, i) => {
					const ref = refs[i];
					if (ref) ctx.spawn(ref, 0, 0, cause as EntityId);
				});
			});
		},
	});
};

test("deferred spawns past popCap are refused, lowest causes first in", () => {
	const world = createWorld({
		seed: 1,
		floors: 1,
		width: 4,
		height: 4,
		popCap: 6,
		modules: [crowd([9, 8, 7, 6, 5, 4])],
	});
	for (let i = 0; i < 3; i++) world.spawn(0, tagged(0), 1, 1);
	world.runRounds(1);
	// The kill frees one of three: four of six spawns fit under the cap.
	const placed = [4, 5, 6, 7].map((n) => world.peek("tag", "v", n as EntityId));
	expect(placed).toEqual([4, 5, 6, 7]);
	expect(world.alive(8 as EntityId)).toBe(false);
	expect(() => world.runRounds(1)).not.toThrow();
});

test("a direct spawn past popCap throws", () => {
	const world = createWorld({
		seed: 1,
		floors: 2,
		width: 4,
		height: 4,
		popCap: 3,
		modules: [],
	});
	const item = { actor: false, components: {} };
	for (let i = 0; i < 3; i++) world.spawn(0, item, 0, 0);
	expect(() => world.spawn(0, item, 0, 0)).toThrow(/popCap/);
	expect(() => world.spawn(1, item, 0, 0)).not.toThrow();
});

test("popCap outside [1, CAP] is rejected", () => {
	for (const popCap of [0, CAP + 1, 1.5])
		expect(() =>
			createWorld({
				seed: 1,
				floors: 1,
				width: 4,
				height: 4,
				popCap,
				modules: [],
			}),
		).toThrow(/popCap/);
});
