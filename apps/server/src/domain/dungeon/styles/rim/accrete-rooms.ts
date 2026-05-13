import { cloneTiles, idx, inBounds } from "../../grid";
import { type Pass, TILE_DOOR, TILE_FLOOR, TILE_WALL } from "../../types";

export type AccreteRoomsParams = {
  readonly maxAttempts?: number;
  readonly maxRooms?: number;
  readonly minSize?: number;
  readonly maxSize?: number;
};

const DEFAULT_MAX_ATTEMPTS = 400;
const DEFAULT_MAX_ROOMS = 25;
const DEFAULT_MIN_SIZE = 4;
const DEFAULT_MAX_SIZE = 8;

type Side = "N" | "E" | "S" | "W";
const SIDES: ReadonlyArray<Side> = ["N", "E", "S", "W"];

type MutableRoom = {
  x: number;
  y: number;
  w: number;
  h: number;
  doors: Array<readonly [number, number]>;
};

export function accreteRooms(params: AccreteRoomsParams = {}): Pass {
  const maxAttempts = params.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const maxRooms = params.maxRooms ?? DEFAULT_MAX_ROOMS;
  const minSize = params.minSize ?? DEFAULT_MIN_SIZE;
  const maxSize = params.maxSize ?? DEFAULT_MAX_SIZE;
  if (!Number.isInteger(maxAttempts) || maxAttempts < 0) {
    throw new Error(
      `accreteRooms: maxAttempts must be a non-negative integer (got ${maxAttempts})`,
    );
  }
  if (!Number.isInteger(maxRooms) || maxRooms < 1) {
    throw new Error(
      `accreteRooms: maxRooms must be a positive integer (got ${maxRooms})`,
    );
  }
  if (!Number.isInteger(minSize) || minSize < 2) {
    throw new Error(
      `accreteRooms: minSize must be an integer >= 2 (got ${minSize})`,
    );
  }
  if (!Number.isInteger(maxSize) || maxSize < minSize) {
    throw new Error(
      `accreteRooms: maxSize must be >= minSize (got ${maxSize}, min ${minSize})`,
    );
  }

  return (level, rng) => {
    const { W, tiles } = cloneTiles(level.grid);

    // Working copy: we extend host.doors in place when committing. The mutable
    // shape is structurally compatible with `ReadonlyArray<Room>`, so no
    // freeze step is needed at the end.
    const rooms: MutableRoom[] = level.rooms.map((r) => ({
      x: r.x,
      y: r.y,
      w: r.w,
      h: r.h,
      doors: [...r.doors],
    }));

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      if (rooms.length >= maxRooms) break;
      if (rooms.length === 0) break;

      const host = rng.pick(rooms);
      const side = rng.pick(SIDES);
      const nw = rng.int(minSize, maxSize);
      const nh = rng.int(minSize, maxSize);

      // Door lives on the host's perimeter (1 cell outside floor). Corners are
      // excluded by sampling the door coordinate strictly within the side's
      // floor span. The new room's floor must be flanked by the door on its
      // matching side; pick the perpendicular offset uniformly to avoid bias.
      let doorX: number;
      let doorY: number;
      let newX: number;
      let newY: number;

      if (side === "N") {
        doorY = host.y - 1;
        doorX = rng.int(host.x, host.x + host.w - 1);
        newY = doorY - nh;
        newX = rng.int(doorX - nw + 1, doorX);
      } else if (side === "S") {
        doorY = host.y + host.h;
        doorX = rng.int(host.x, host.x + host.w - 1);
        newY = doorY + 1;
        newX = rng.int(doorX - nw + 1, doorX);
      } else if (side === "W") {
        doorX = host.x - 1;
        doorY = rng.int(host.y, host.y + host.h - 1);
        newX = doorX - nw;
        newY = rng.int(doorY - nh + 1, doorY);
      } else {
        doorX = host.x + host.w;
        doorY = rng.int(host.y, host.y + host.h - 1);
        newX = doorX + 1;
        newY = rng.int(doorY - nh + 1, doorY);
      }

      // Bounds check: floor + 1-cell perimeter must all fit in the grid.
      if (
        !inBounds(newX - 1, newY - 1, level.grid) ||
        !inBounds(newX + nw, newY + nh, level.grid)
      ) {
        continue;
      }

      // Overlap check: every floor cell AND every perimeter cell must be
      // TILE_WALL right now. Including the perimeter is what guarantees that
      // two rooms can never share a wall — only a door tile.
      let blocked = false;
      for (let yy = newY - 1; yy <= newY + nh && !blocked; yy++) {
        for (let xx = newX - 1; xx <= newX + nw; xx++) {
          if (tiles[idx(xx, yy, W)] !== TILE_WALL) {
            blocked = true;
            break;
          }
        }
      }
      if (blocked) continue;

      // Commit: carve floor, place door, register room, mirror door on host.
      for (let yy = newY; yy < newY + nh; yy++) {
        for (let xx = newX; xx < newX + nw; xx++) {
          tiles[idx(xx, yy, W)] = TILE_FLOOR;
        }
      }
      tiles[idx(doorX, doorY, W)] = TILE_DOOR;

      const newRoom: MutableRoom = {
        x: newX,
        y: newY,
        w: nw,
        h: nh,
        doors: [[doorX, doorY]],
      };
      host.doors.push([doorX, doorY]);
      rooms.push(newRoom);
    }

    // No defensive .map(): MutableRoom[] is structurally assignable to
    // ReadonlyArray<Room> (Array <: ReadonlyArray + writable→readonly fields +
    // Array<...> <: ReadonlyArray<...> on `doors`). We own `rooms` and never
    // expose it, so there's no way for a consumer to mutate it after return.
    return {
      ...level,
      grid: { ...level.grid, tiles },
      rooms,
    };
  };
}
