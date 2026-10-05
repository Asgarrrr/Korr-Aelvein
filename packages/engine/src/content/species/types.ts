import type { Species } from "../../core/species";
import type { modules } from "../../registry";

export type GameSpecies = Species<typeof modules>;
