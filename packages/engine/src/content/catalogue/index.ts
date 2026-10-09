import { MAX_SEED } from "../../core/config";
import { species as fixed } from "../species";
import type { GameSpecies } from "../species/types";
import { archetypes, type Niche } from "./archetypes";
import { rows, tiers } from "./config";
import { express } from "./expression";
import { drawGenome } from "./genome";
import type { Look } from "./types";

export type SpeciesName = keyof typeof fixed | `${Niche}.${number}`;

export interface Catalogue {
	readonly species: Readonly<Record<string, GameSpecies>>;
	readonly looks: Readonly<Record<string, Look>>;
}

function lookOf(stem: string, entry: GameSpecies): Look {
	const max = entry.components.vitality?.max;
	const tier =
		typeof max === "number" ? tiers.filter((t) => t <= max).length : 0;
	return Object.freeze({ stem, tier });
}

export function catalogue(seed: number): Catalogue {
	if (!(Number.isInteger(seed) && seed >= 0 && seed <= MAX_SEED))
		throw new Error(`seed ${seed} is not a u32`);
	const species: Record<string, GameSpecies> = {};
	const looks: Record<string, Look> = {};
	const add = (name: string, stem: string, entry: GameSpecies) => {
		if (Object.hasOwn(species, name))
			throw new Error(`species ${name} is defined twice`);
		species[name] = entry;
		looks[name] = lookOf(stem, entry);
	};
	for (const [name, entry] of Object.entries(fixed)) add(name, name, entry);
	for (const [niche, { stem, body, genes }] of Object.entries(archetypes)) {
		const name = `${niche}.0`;
		add(name, stem, express(drawGenome(seed, name, genes), rows, body));
	}
	return Object.freeze({
		species: Object.freeze(species),
		looks: Object.freeze(looks),
	});
}
