// Public surface for the dungeon module.
//
// Imports the per-style pipelines (`RIM`, `CAVERNS`) from their respective
// folders and dispatches via `StyleId`. Adding a style = adding a folder under
// `styles/`, a `Pipeline` constant, and one line in `PIPELINES`.

import type { Rng } from "../rng/index";
import {
  getTile,
  idx,
  inBounds,
  neighbors4,
  neighbors8,
  setTile,
} from "./grid";
import { CAVERNS } from "./styles/caverns/index";
import { RIM } from "./styles/rim/index";
import {
  type Grid,
  type Level,
  type Pass,
  type Pipeline,
  type Room,
  TILE_DOOR,
  TILE_FLOOR,
  TILE_WALL,
  type Tile,
} from "./types";

export type { Grid, Level, Pass, Pipeline, Room, Tile };
export {
  getTile,
  idx,
  inBounds,
  neighbors4,
  neighbors8,
  setTile,
  TILE_DOOR,
  TILE_FLOOR,
  TILE_WALL,
};

export function emptyLevel(width: number, height: number): Level {
  if (!Number.isInteger(width) || width <= 0) {
    throw new Error(
      `emptyLevel: width must be a positive integer (got ${width})`,
    );
  }
  if (!Number.isInteger(height) || height <= 0) {
    throw new Error(
      `emptyLevel: height must be a positive integer (got ${height})`,
    );
  }
  return {
    grid: {
      width,
      height,
      tiles: new Uint8Array(width * height),
    },
    rooms: [],
    spawn: null,
    downStairs: null,
  };
}

export function runPipeline(level: Level, rng: Rng, passes: Pipeline): Level {
  return passes.reduce<Level>((acc, pass) => pass(acc, rng), level);
}

export type StyleId = "rim" | "caverns";

const PIPELINES: Readonly<Record<StyleId, Pipeline>> = {
  rim: RIM,
  caverns: CAVERNS,
};

export function generateLevel(
  rng: Rng,
  width: number,
  height: number,
  style: StyleId,
): Level {
  return runPipeline(emptyLevel(width, height), rng, PIPELINES[style]);
}
