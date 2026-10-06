import { species } from "./content/species";
import type { EntityId } from "./core/ecs/ids";
import type { SpawnFields } from "./core/lifecycle/species";
import {
	type World as AnyWorld,
	createWorld,
	type LoadOptions,
	loadWorld,
	type WorldOptions,
} from "./core/world/world";
import { modules } from "./registry";

export const game = { modules, species } as const;

export type SpeciesName = keyof typeof species;

export interface World
	extends Omit<AnyWorld<typeof modules, SpeciesName>, "spawn" | "spawnPlayer"> {
	spawn(
		floor: number,
		species: SpeciesName,
		x: number,
		y: number,
		values?: SpawnFields<typeof modules>,
	): EntityId;
	spawnPlayer(
		floor: number,
		species: SpeciesName,
		x: number,
		y: number,
		values?: SpawnFields<typeof modules>,
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
