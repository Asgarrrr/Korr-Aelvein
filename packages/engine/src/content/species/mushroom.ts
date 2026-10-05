import { foodClass } from "../../modules/hunger/config";
import type { GameSpecies } from "./types";

export const mushroom = {
	actor: false,
	components: {
		edible: { nutrition: 300, class: foodClass.forage },
		flammable: { burn: 2 },
	},
} satisfies GameSpecies;
