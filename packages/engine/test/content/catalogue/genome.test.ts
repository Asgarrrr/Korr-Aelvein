import { expect, test } from "bun:test";
import { GENE_MAX } from "../../../src/content/catalogue/expression";
import { drawGenome } from "../../../src/content/catalogue/genome";

const SEEDS = Array.from({ length: 32 }, (_, i) => i + 1);
const SIZE = { size: { min: 32, max: 224 } };
const WIDE = { size: { min: 0, max: GENE_MAX } };

test("every gene is drawn within its bounds", () => {
	for (const seed of SEEDS) {
		const { size } = drawGenome(seed, "herbivore.0", SIZE);
		expect(size).toBeGreaterThanOrEqual(32);
		expect(size).toBeLessThanOrEqual(224);
		expect(Number.isInteger(size)).toBe(true);
	}
});

test("adding a gene re-rolls no other gene", () => {
	for (const seed of SEEDS)
		expect(
			drawGenome(seed, "herbivore.0", { ...WIDE, bite: { min: 0, max: 9 } })
				.size,
		).toBe(drawGenome(seed, "herbivore.0", WIDE).size);
});

test("another species name or seed draws other values", () => {
	const size = (seed: number, name: string) =>
		drawGenome(seed, name, WIDE).size;
	expect(
		SEEDS.some((s) => size(s, "herbivore.0") !== size(s, "herbivore.1")),
	).toBe(true);
	expect(
		SEEDS.some((s) => size(s, "herbivore.0") !== size(s + 1, "herbivore.0")),
	).toBe(true);
});
