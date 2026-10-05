import type { Contracts } from "../../contracts";
import type { Schema } from "../../core/api";

export const schema = {
	satiety: { value: "i32" },
	edible: { nutrition: "i16", class: "u8" },
	diet: { eats: "u8" },
} as const satisfies Schema & Pick<Contracts, "diet" | "edible" | "satiety">;
