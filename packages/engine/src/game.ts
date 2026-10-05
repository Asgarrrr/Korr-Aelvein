import { species } from "./content/species";
import type { GameSpecies } from "./content/species/types";
import type { EntityId } from "./core/ecs/ids";
import {
	type World as AnyWorld,
	createWorld,
	type LoadOptions,
	loadWorld,
	type WorldOptions,
} from "./core/world";
import { modules } from "./registry";

export const game = { modules, species } as const;

export type SpeciesName = keyof typeof species;

export interface World
	extends Omit<AnyWorld<typeof modules>, "spawn" | "spawnPlayer"> {
	spawn(
		floor: number,
		species: SpeciesName,
		x: number,
		y: number,
		values?: GameSpecies["components"],
	): EntityId;
	spawnPlayer(
		floor: number,
		species: SpeciesName,
		x: number,
		y: number,
		values?: GameSpecies["components"],
	): EntityId;
}

export function createGame(
	options: Omit<
		WorldOptions<typeof modules>,
		"modules" | "species" | "floorOrder" | "audit"
	>,
): World {
	return createWorld({ ...options, ...game });
}

export function loadGame(bytes: Uint8Array, options: LoadOptions = {}): World {
	const { check } = options;
	return loadWorld(bytes, check === undefined ? game : { ...game, check });
}
