import { expect, test } from "bun:test";
import { allocated } from "../../bench/reference/allocated";
import { species } from "../../src/content/species";
import { CAP } from "../../src/core/config";
import { defineModule } from "../../src/core/module/api";
import { createEngine } from "../../src/core/setup/registration";
import { modules } from "../../src/registry";

const shape = {
	seed: 1,
	floors: 1,
	width: 4,
	height: 4,
	popCap: 8,
	events: false,
};

const hoarder = defineModule({
	name: "hoarder",
	schema: {},
	config: {},
	setup(b) {
		const held = b.query(["satiety"]);
		b.tick((ctx) => {
			held.slots(ctx);
		});
	},
});

test("allocated counts the slot list of a query held only by a module closure", () => {
	const base = allocated(createEngine(shape, modules, species)).total;
	const more = allocated(
		createEngine(shape, [...modules, hoarder], species),
	).total;
	expect(more - base).toBeGreaterThanOrEqual(
		CAP * Int32Array.BYTES_PER_ELEMENT,
	);
});
