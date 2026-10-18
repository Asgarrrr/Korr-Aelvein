import type { Archetype } from "../types";
import { rat } from "./rat";

export const archetypes = { herbivore: rat } as const satisfies Record<
	string,
	Archetype
>;

export type Niche = keyof typeof archetypes;
