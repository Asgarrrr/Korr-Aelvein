import { getTile, inBounds, TILE_WALL } from "../dungeon/index";
import type { GameState } from "./state";

export type Dir = "n" | "e" | "s" | "w";
export type Action = { readonly type: "MOVE"; readonly dir: Dir };

function dirDelta(dir: Dir): readonly [number, number] {
  if (dir === "n") return [0, -1];
  if (dir === "e") return [1, 0];
  if (dir === "s") return [0, 1];
  return [-1, 0]; // "w"
}

export function tick(state: GameState, action: Action): GameState {
  if (action.type === "MOVE") {
    const [dx, dy] = dirDelta(action.dir);
    const nx = state.player.x + dx;
    const ny = state.player.y + dy;
    if (!inBounds(nx, ny, state.level.grid)) return state;
    if (getTile(state.level.grid, nx, ny) === TILE_WALL) return state;
    return {
      ...state,
      player: { x: nx, y: ny },
      turn: state.turn + 1,
    };
  }
  return state;
}
