import type { GameSpecies } from "./types";

export const moss = {
	actor: false,
	components: { sprout: { period: 20, left: 20 } },
} satisfies GameSpecies;
