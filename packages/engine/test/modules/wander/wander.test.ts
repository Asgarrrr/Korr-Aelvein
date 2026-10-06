import { expect, test } from "bun:test";
import { LOD_PERIODS } from "../../../src/core/config";
import { createWorld } from "../../../src/core/world/world";
import { wander } from "../../../src/modules/wander";
import { modules } from "../../../src/registry";
import { decider, decisions, idleRounds, populatedWorld } from "../../fixtures";

test("the game runs without wander, and rats that cannot roam starve", () => {
	const { world, rats } = populatedWorld(
		1,
		modules.filter((m) => m !== wander),
	);
	world.runRounds(1000);
	expect(rats.some((id) => world.alive(id))).toBe(false);
});

// Floor 4 of 5, with the only player on floor 0: one full decision in 64 turns.
const FAR = 4;
const statue = { actor: true, components: {} };

test("a boxed-in roamer idles on its cached decision instead of deciding again every turn", () => {
	decisions.clear();
	const world = createWorld({
		seed: 1,
		floors: FAR + 1,
		width: 3,
		height: 3,
		modules: [wander, decider],
	});
	world.spawnPlayer(0, statue, 0, 0);
	for (let y = 0; y < 3; y++)
		for (let x = 0; x < 3; x++)
			if (x !== 1 || y !== 1) world.spawn(FAR, statue, x, y);
	const roamer = world.spawn(FAR, statue, 1, 1);
	idleRounds(world, LOD_PERIODS[FAR] ?? 0);
	expect(decisions.get(roamer)).toBeLessThanOrEqual(2);
});
