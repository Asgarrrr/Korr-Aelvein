import { species } from "../../../src/content/species";
import { createWorld } from "../../../src/core/world/world";
import { modules } from "../../../src/registry";

const world = createWorld({
	seed: 1,
	floors: 1,
	width: 4,
	height: 4,
	modules,
	species,
});
// @ts-expect-error a spawn's values are integers: only a species draws from a range
world.spawn(0, "rat", 0, 0, { satiety: { value: { min: 1, max: 2 } } });
createWorld({
	seed: 1,
	floors: 1,
	width: 4,
	height: 4,
	modules,
	// @ts-expect-error a species table entry is checked against the registered schemas
	species: { ...species, bad: { actor: false, components: { wings: {} } } },
});
