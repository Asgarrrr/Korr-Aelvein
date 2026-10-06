import type { CellContracts } from "../../contracts";
import type { Schema } from "../../core/module/api";

export const schema = {
	// Turns its cell burns once this fuel ignites.
	flammable: { burn: "u8" },
	ignites: {},
} as const satisfies Schema;

// `source` is the entity that fed the fire: the ember or the fuel it consumed.
export const cells = {
	fire: { left: "u8", source: "entity" },
} as const satisfies Schema & Pick<CellContracts, "fire">;
