export { type Catalogue, catalogue } from "./content/catalogue";
export type { Look } from "./content/catalogue/types";
export type { EntityId } from "./core/ecs/ids";
export type { EventVisitor } from "./core/events/events";
export type {
	InputRecord,
	LoadCheck,
	LoadOptions,
	Location,
} from "./core/world/world";
export {
	createGame,
	loadGame,
	type SpeciesName,
	type World,
} from "./game";
export { createStarterGame, starter } from "./world/starter";
