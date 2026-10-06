import { foodClass } from "../../modules/hunger/config";
import type { GameSpecies } from "./types";

export const rat = {
	actor: true,
	components: {
		satiety: { value: 800 },
		diet: { eats: foodClass.forage },
		edible: { nutrition: 400, class: foodClass.meat },
		wary: {},
		temperament: { boldness: { min: 20, max: 140 } },
		vitality: { hp: 10, max: 10 },
	},
} satisfies GameSpecies;
