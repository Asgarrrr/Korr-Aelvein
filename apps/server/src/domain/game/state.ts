import type { Level } from "../dungeon/index";
import { generateLevel, type StyleId } from "../dungeon/index";
import type { RngState } from "../rng/index";
import { createRng } from "../rng/index";

export type Player = {
  readonly x: number;
  readonly y: number;
};

export type GameState = {
  readonly level: Level;
  readonly player: Player;
  readonly rngState: RngState;
  readonly turn: number;
};

export function newGame(seed: number, style: StyleId): GameState {
  const rng = createRng(seed);
  const level = generateLevel(rng, 80, 30, style);
  if (level.spawn === null) {
    throw new Error("newGame: generated level has no spawn point");
  }
  const [x, y] = level.spawn;
  return {
    level,
    player: { x, y },
    rngState: rng.state(),
    turn: 0,
  };
}
