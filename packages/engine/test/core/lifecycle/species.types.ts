import { species } from "../../../src/content/species";
import { createWorld } from "../../../src/core/world/world";
import { modules } from "../../../src/registry";

createWorld({ seed: 1, floors: 1, width: 4, height: 4, modules, species });
createWorld({
	seed: 1,
	floors: 1,
	width: 4,
	height: 4,
	modules,
	// @ts-expect-error a species table entry is checked against the registered schemas
	species: { ...species, bad: { actor: false, components: { wings: {} } } },
});
