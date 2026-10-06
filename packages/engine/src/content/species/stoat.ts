import { foodClass } from "../../modules/hunger/config";
import type { GameSpecies } from "./types";

export const stoat = {
	actor: true,
	components: {
		satiety: { value: 800 },
		diet: { eats: foodClass.meat },
		vitality: { hp: 16, max: 16 },
		temperament: { boldness: { min: 120, max: 240 } },
	},
} satisfies GameSpecies;
