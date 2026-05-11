import { idx } from "../../grid";
import { type Pass, type Room, TILE_FLOOR } from "../../types";

export type PlaceFirstRoomParams = {
  readonly minSize?: number;
  readonly maxSize?: number;
};

const DEFAULT_MIN_SIZE = 5;
const DEFAULT_MAX_SIZE = 9;

export function placeFirstRoom(params: PlaceFirstRoomParams = {}): Pass {
  const minSize = params.minSize ?? DEFAULT_MIN_SIZE;
  const maxSize = params.maxSize ?? DEFAULT_MAX_SIZE;
  if (!Number.isInteger(minSize) || minSize < 1) {
    throw new Error(
      `placeFirstRoom: minSize must be a positive integer (got ${minSize})`,
    );
  }
  if (!Number.isInteger(maxSize) || maxSize < minSize) {
    throw new Error(
      `placeFirstRoom: maxSize must be >= minSize (got ${maxSize}, min ${minSize})`,
    );
  }

  return (level, rng) => {
    if (level.rooms.length > 0) {
      throw new Error(
        `placeFirstRoom: precondition violated — expected an empty rooms array (got ${level.rooms.length})`,
      );
    }
    const { width: W, height: H } = level.grid;
    const w = rng.int(minSize, maxSize);
    const h = rng.int(minSize, maxSize);
    if (w > W || h > H) {
      throw new Error(
        `placeFirstRoom: room (${w}x${h}) does not fit grid (${W}x${H})`,
      );
    }
    const x = Math.floor((W - w) / 2);
    const y = Math.floor((H - h) / 2);

    const tiles = new Uint8Array(level.grid.tiles);
    for (let yy = y; yy < y + h; yy++) {
      for (let xx = x; xx < x + w; xx++) {
        tiles[idx(xx, yy, W)] = TILE_FLOOR;
      }
    }

    const cx = x + Math.floor(w / 2);
    const cy = y + Math.floor(h / 2);
    const room: Room = { x, y, w, h, doors: [] };

    return {
      ...level,
      grid: { ...level.grid, tiles },
      rooms: [room],
      spawn: [cx, cy],
    };
  };
}
