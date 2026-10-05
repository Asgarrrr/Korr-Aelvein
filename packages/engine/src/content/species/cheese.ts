import { foodClass } from "../../modules/hunger/config";
import type { GameSpecies } from "./types";

export const cheese = {
	actor: false,
	components: { edible: { nutrition: 600, class: foodClass.forage } },
} satisfies GameSpecies;
