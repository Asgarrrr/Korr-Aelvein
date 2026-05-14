import type { Level } from "../dungeon/index";
import { generateLevel, type StyleId } from "../dungeon/index";
import { type EntityHandle, emptyWorld, spawn, type World } from "../ecs/index";
import type { RngState } from "../rng/index";
import { createRng } from "../rng/index";
import { emptyScheduler, type Scheduler, schedule } from "../scheduler/index";

export type GameState = {
  readonly level: Level;
  // Mutated in place by `tick`. The `GameState` wrapper changes per tick,
  // but `state.world` is the same reference before and after.
  readonly world: World;
  readonly playerId: EntityHandle;
  // Same mutation model as `world`: replaced wrapper, same heap reference.
  readonly scheduler: Scheduler;
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
  const world = emptyWorld();
  const playerId = spawn(world, {
    position: { x, y },
    actor: { glyph: "@", name: "you" },
    hp: { current: 10, max: 10 },
  });
  const scheduler = emptyScheduler();
  schedule(scheduler, 0, playerId);
  return {
    level,
    world,
    playerId,
    scheduler,
    rngState: rng.state(),
    turn: 0,
  };
}
