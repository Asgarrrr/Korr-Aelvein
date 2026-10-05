import type { Schema } from "../ecs/schema";

// Components the core owns: a species gives them like any other, and no module writes them.
export const coreSchema = {
	vitality: { hp: "i16", max: "i16" },
	// Where stairs lead: the destination floor and the arrival cell there.
	link: { floor: "u8", x: "i16", y: "i16" },
} as const satisfies Schema;

export type CoreSchema = typeof coreSchema;

export const I16_MAX = 0x7fff;

// The same rule a load applies, so a spawn cannot write a save that load rejects.
export function healthy(hp: number, max: number): boolean {
	return hp > 0 && hp <= max && max <= I16_MAX;
}
