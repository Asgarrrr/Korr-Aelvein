import { rat as body } from "../../species/rat";
import type { Archetype } from "../types";

export const rat = {
	stem: "rat",
	body,
	genes: { size: { min: 32, max: 224 } },
} satisfies Archetype;
