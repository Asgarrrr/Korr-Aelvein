import { expect, test } from "bun:test";
import { catalogue } from "../../../src/content/catalogue";
import { foodWeb } from "../../../src/content/catalogue/web";

const SEEDS = Array.from({ length: 100 }, (_, i) => i);

test("every actor species with a diet has a food in its seed's catalogue", () => {
	for (const seed of SEEDS) {
		const { species } = catalogue(seed);
		const eaters = new Set(foodWeb(species).map((edge) => edge.eater));
		for (const [name, entry] of Object.entries(species))
			if (entry.actor && entry.components.diet)
				expect({ seed, name, fed: eaters.has(name) }).toEqual({
					seed,
					name,
					fed: true,
				});
	}
});
