import type { GameSpecies } from "./types";

export const mushroom = {
	actor: false,
	components: { edible: { nutrition: 300 } },
} satisfies GameSpecies;
