import type { GameSpecies } from "../species/types";

export type Gene = "size";

// 0 <= min <= max <= GENE_MAX.
export interface GeneRange {
	readonly min: number;
	readonly max: number;
}

export interface Archetype {
	readonly stem: string;
	readonly body: GameSpecies;
	readonly genes: Readonly<Record<Gene, GeneRange>>;
}

export interface Look {
	readonly stem: string;
	readonly tier: number;
}
