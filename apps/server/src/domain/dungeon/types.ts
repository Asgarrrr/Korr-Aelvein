import type { Rng } from "../rng/index";

export const TILE_WALL: 0 = 0;
export const TILE_FLOOR: 1 = 1;
export const TILE_DOOR: 2 = 2;

export type Tile = 0 | 1 | 2;

export type Grid = {
  readonly width: number;
  readonly height: number;
  readonly tiles: Uint8Array;
};

// A door tile lives on the grid AND is referenced by `doors` on BOTH rooms it
// connects (the same `[x, y]` appears twice across the two rooms' `doors`
// arrays). One door tile, two room-side references — that's the convention.
//
// Loops added by `addLoops` are an exception: they are standalone door tiles
// on the grid with no room-side references, since they're not naturally tied
// to a single room pair. See `passes/addLoops.ts` for the rationale.
export type Room = {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly doors: ReadonlyArray<readonly [number, number]>;
};

// `null` (not `?:`) for spawn/downStairs because `exactOptionalPropertyTypes`
// is on — `null` makes "no value yet" explicit at every reader.
export type Level = {
  readonly grid: Grid;
  readonly rooms: ReadonlyArray<Room>;
  readonly spawn: readonly [number, number] | null;
  readonly downStairs: readonly [number, number] | null;
};

export type Pass = (level: Level, rng: Rng) => Level;

export type Pipeline = ReadonlyArray<Pass>;
