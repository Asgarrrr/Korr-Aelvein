import type { Schema } from "../ecs/schema";

// Components the core owns: a species gives them like any other, and no module writes them.
export const coreSchema = {
	vitality: { hp: "i16", max: "i16" },
} as const satisfies Schema;

export type CoreSchema = typeof coreSchema;

const I16_MAX = 0x7fff;

// The same rule a load applies, so a spawn cannot write a save that load rejects.
export function checkVitality(
	values: { readonly [field: string]: number | undefined } | undefined,
): void {
	if (values === undefined) return;
	const hp = values.hp ?? 0;
	const max = values.max ?? 0;
	if (!(hp > 0 && hp <= max && max <= I16_MAX))
		throw new Error(
			`vitality hp ${hp}, max ${max}: needs 0 < hp <= max <= ${I16_MAX}`,
		);
}
