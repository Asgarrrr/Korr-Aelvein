import {
  generateLevel,
  getTile,
  type Level,
  type StyleId,
  TILE_WALL,
} from "../dungeon/index";
import {
  type EntityHandle,
  emptyWorld,
  query,
  spawn,
  type World,
} from "../ecs/index";
import { createRng, type Rng, type RngState } from "../rng/index";
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

const WANDERER_COUNT = 2;

export function newGame(seed: number, style: StyleId): GameState {
  const rng = createRng(seed);
  const level = generateLevel(rng, 80, 30, style);
  if (level.spawn === null) {
    throw new Error("newGame: generated level has no spawn point");
  }
  const [px, py] = level.spawn;
  const world = emptyWorld();
  const playerId = spawn(world, {
    position: { x: px, y: py },
    actor: { glyph: "@", name: "you" },
    hp: { current: 10, max: 10 },
  });
  const scheduler = emptyScheduler();
  // Player at seq=0 — same time as wanderers below, but lower seq wins the
  // FIFO tiebreak so the player always acts first on turn 1.
  schedule(scheduler, 0, playerId);

  const floors = listFloorCells(level);
  const taken = new Set<string>([cellKey(px, py)]);
  for (let i = 0; i < WANDERER_COUNT; i++) {
    const [wx, wy] = pickFreeFloor(rng, floors, taken);
    const wanderer = spawn(world, {
      position: { x: wx, y: wy },
      actor: { glyph: "r", name: "wanderer" },
      ai: { kind: "wanderer" },
    });
    schedule(scheduler, 0, wanderer);
    taken.add(cellKey(wx, wy));
  }

  return {
    level,
    world,
    playerId,
    scheduler,
    rngState: rng.state(),
    turn: 0,
  };
}

function cellKey(x: number, y: number): string {
  return `${x},${y}`;
}

function listFloorCells(level: Level): Array<readonly [number, number]> {
  const { width, height } = level.grid;
  const out: Array<readonly [number, number]> = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (getTile(level.grid, x, y) !== TILE_WALL) out.push([x, y]);
    }
  }
  return out;
}

function pickFreeFloor(
  rng: Rng,
  floors: ReadonlyArray<readonly [number, number]>,
  taken: ReadonlySet<string>,
): readonly [number, number] {
  // Single allocation, one rng.pick — no rejection loop, no determinism trap
  // from variable-length RNG consumption.
  const available = floors.filter(([x, y]) => !taken.has(cellKey(x, y)));
  if (available.length === 0) {
    throw new Error("pickFreeFloor: no floor cells available");
  }
  return rng.pick(available);
}

/**
 * True if any live entity with `position + actor` occupies `(x, y)`. Used by
 * tick (player MOVE refusal) and ai (wanderer step refusal) to enforce
 * "one actor per tile". Phase 3 bump-combat will replace the player's
 * refusal branch with an ATTACK action.
 */
export function cellBlocked(state: GameState, x: number, y: number): boolean {
  for (const [_handle, view] of query(state.world, ["position", "actor"])) {
    const p = view.position;
    if (p !== undefined && p.x === x && p.y === y) return true;
  }
  return false;
}
