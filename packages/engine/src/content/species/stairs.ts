import type { GameSpecies } from "./types";

// Placeholder destination: spawn a copy whose link names the real floor and arrival cell.
export const stairs = {
	actor: false,
	components: { link: { floor: 0, x: 0, y: 0 } },
} satisfies GameSpecies;
