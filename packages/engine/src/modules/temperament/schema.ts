import type { Contracts } from "../../contracts";
import type { Schema } from "../../core/module/api";

export const schema = {
	temperament: { boldness: "u8" },
} as const satisfies Schema & Pick<Contracts, "temperament">;
