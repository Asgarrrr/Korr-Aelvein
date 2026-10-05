import type { GameSpecies } from "./types";

export const rat = {
	actor: true,
	components: { satiety: { value: 800 } },
} satisfies GameSpecies;
