import { bounded, draw, hashName, PHASE, SUBJECT } from "../../core/random/rng";
import type { GeneRange } from "./types";

const CATALOGUE = hashName("catalogue");

export function drawGenome<G extends string>(
	seed: number,
	name: string,
	bounds: Readonly<Record<G, GeneRange>>,
): Record<G, number> {
	const genome = {} as Record<G, number>;
	for (const gene of Object.keys(bounds) as G[]) {
		const { min, max } = bounds[gene];
		const h = draw(
			seed,
			CATALOGUE,
			PHASE.spawn,
			0,
			SUBJECT.entity,
			hashName(name),
			hashName(gene),
		);
		genome[gene] = min + bounded(h, max - min + 1);
	}
	return genome;
}
