import type { FieldRange } from "../../core/lifecycle/species";
import type { GameSpecies } from "../species/types";

export interface FoodEdge {
	readonly eater: string;
	readonly food: string;
}

// A class mask drawn from a Range has no single value: it feeds no edge.
const mask = (value: number | FieldRange | undefined) =>
	typeof value === "number" ? value : 0;

export function foodWeb(
	table: Readonly<Record<string, GameSpecies>>,
): readonly FoodEdge[] {
	const names = Object.keys(table).sort();
	const edges: FoodEdge[] = [];
	for (const eater of names) {
		const eats = mask(table[eater]?.components.diet?.eats);
		if (eats === 0) continue;
		for (const food of names)
			if ((eats & mask(table[food]?.components.edible?.class)) !== 0)
				edges.push(Object.freeze({ eater, food }));
	}
	return Object.freeze(edges);
}
