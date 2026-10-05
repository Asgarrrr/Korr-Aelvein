import { expect, test } from "bun:test";
import { wander } from "../../../src/modules/wander";
import { modules } from "../../../src/registry";
import { populatedWorld } from "../../fixtures";

test("the game runs without wander, and rats that cannot roam starve", () => {
	const { world, rats } = populatedWorld(
		1,
		modules.filter((m) => m !== wander),
	);
	world.runRounds(1000);
	expect(rats.some((id) => world.alive(id))).toBe(false);
});
