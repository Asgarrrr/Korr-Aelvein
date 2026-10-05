import type { GameSpecies } from "./types";

export const cheese = {
	actor: false,
	components: { edible: { nutrition: 600 } },
} satisfies GameSpecies;
