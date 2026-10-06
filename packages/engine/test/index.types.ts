// Checked by `tsc` only: each @ts-expect-error fails the typecheck if the entry starts exporting it.
import type * as entry from "../src/index";

// @ts-expect-error the engine state stays behind the World API
export type HiddenEngine = entry.Engine;
// @ts-expect-error a slot never leaves a core callback
export type HiddenSlot = entry.Slot;
// @ts-expect-error entity storage is core internals
export type HiddenStorage = entry.Storage;
// @ts-expect-error callers get the game, not an arbitrary registry
export type HiddenCreateWorld = typeof entry.createWorld;
// @ts-expect-error callers load the game, not an arbitrary registry
export type HiddenLoadWorld = typeof entry.loadWorld;
// @ts-expect-error a module definition is not part of the server's surface
export type HiddenDefineModule = typeof entry.defineModule;

declare const world: entry.World;
declare const createGame: typeof entry.createGame;
const side = { seed: 1, floors: 1, width: 8, height: 8 } as const;

export const name: entry.SpeciesName = "rat";
world.spawn(0, name, 1, 1);
// @ts-expect-error spawn takes the game's species names only
world.spawn(0, "dragon", 1, 1);
// @ts-expect-error a species shape is for tests on the core World
world.spawn(0, { actor: false, components: {} }, 1, 1);
// @ts-expect-error spawnPlayer takes the game's species names only
world.spawnPlayer(0, "dragon", 1, 1);
// @ts-expect-error floor order is a test knob of createWorld
createGame({ ...side, floorOrder: [0] });
// @ts-expect-error audit mode is a test knob of createWorld
createGame({ ...side, audit: true });
// The game lists its own species names, not any string.
world.entities(0, (_id, species: entry.SpeciesName) => species);
