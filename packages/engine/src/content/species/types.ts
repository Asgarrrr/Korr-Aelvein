import type { Species } from "../../core/lifecycle/species";
import type { modules } from "../../registry";

export type GameSpecies = Species<typeof modules>;
