import { getTile, inBounds, TILE_WALL } from "../dungeon/index";
import { getComponent, isLiveHandle, setComponent } from "../ecs/index";
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
    if (!isLiveHandle(state.world, state.playerId)) {
      throw new Error("tick: player handle is stale (entity despawned)");
    }
    const pos = getComponent(state.world, state.playerId, "position");
    if (pos === undefined) {
      throw new Error("tick: player entity is missing the position component");
    }
    const [dx, dy] = dirDelta(action.dir);
    const nx = pos.x + dx;
    const ny = pos.y + dy;
    if (!inBounds(nx, ny, state.level.grid)) return state;
    if (getTile(state.level.grid, nx, ny) === TILE_WALL) return state;
    setComponent(state.world, state.playerId, "position", { x: nx, y: ny });
    return { ...state, turn: state.turn + 1 };
  }
  return state;
}
