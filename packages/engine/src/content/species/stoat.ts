import { foodClass } from "../../modules/hunger/config";
import type { GameSpecies } from "./types";

export const stoat = {
	actor: true,
	components: {
		satiety: { value: 800 },
		diet: { eats: foodClass.meat },
	},
} satisfies GameSpecies;
