import { DX4, DY4, idx, inBounds } from "../../grid";
import { type Pass, TILE_DOOR, TILE_FLOOR, TILE_WALL } from "../../types";

export type AddLoopsParams = {
  readonly maxAttempts?: number;
  readonly maxLoops?: number;
  readonly minPathDistance?: number;
};

const DEFAULT_MAX_ATTEMPTS = 200;
const DEFAULT_MAX_LOOPS = 15;
const DEFAULT_MIN_PATH_DISTANCE = 5;

export function addLoops(params: AddLoopsParams = {}): Pass {
  const maxAttempts = params.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const maxLoops = params.maxLoops ?? DEFAULT_MAX_LOOPS;
  const minPathDistance = params.minPathDistance ?? DEFAULT_MIN_PATH_DISTANCE;
  if (!Number.isInteger(maxAttempts) || maxAttempts < 0) {
    throw new Error(
      `addLoops: maxAttempts must be a non-negative integer (got ${maxAttempts})`,
    );
  }
  if (!Number.isInteger(maxLoops) || maxLoops < 0) {
    throw new Error(
      `addLoops: maxLoops must be a non-negative integer (got ${maxLoops})`,
    );
  }
  if (!Number.isInteger(minPathDistance) || minPathDistance < 1) {
    throw new Error(
      `addLoops: minPathDistance must be a positive integer (got ${minPathDistance})`,
    );
  }

  return (level, rng) => {
    const W = level.grid.width;
    const H = level.grid.height;
    const tiles = new Uint8Array(level.grid.tiles);
    const cap = W * H;

    // Hoist BFS scratch buffers out of the attempt loop. We reuse them across
    // up to `maxAttempts` BFS calls — `visited.fill(0)` between attempts. This
    // replaces ~maxAttempts × (Uint8Array(cap) + 3 × number[]) allocations
    // (~480 kB churn per generateLevel at 80×30) with 4 fixed allocations.
    const visited = new Uint8Array(cap);
    const queueX = new Int32Array(cap);
    const queueY = new Int32Array(cap);
    const queueD = new Int32Array(cap);

    const isWalkable = (x: number, y: number): boolean => {
      if (!inBounds(x, y, level.grid)) return false;
      const t = tiles[idx(x, y, W)];
      return t === TILE_FLOOR || t === TILE_DOOR;
    };

    // BFS as a closure over the hoisted scratch buffers + the candidate-wall
    // blocker. Returns true iff the shortest path from (sx,sy) to (gx,gy)
    // through walkable tiles (excluding the blocker) is strictly > threshold,
    // OR the goal is unreachable without crossing the blocker.
    //
    // Inline neighbor body (not via a `visit` closure) — benchmarked: nested
    // closure regresses by ~14% on JSC because `runBfs` is called many times
    // per pass and the inner `visit` capture has to box `tail` / `result`.
    const runBfs = (
      sx: number,
      sy: number,
      gx: number,
      gy: number,
      bx: number,
      by: number,
    ): boolean => {
      if (sx === gx && sy === gy) return 0 > minPathDistance;
      visited.fill(0);
      queueX[0] = sx;
      queueY[0] = sy;
      queueD[0] = 0;
      visited[sy * W + sx] = 1;
      let head = 0;
      let tail = 1;
      while (head < tail) {
        const cx = queueX[head];
        const cy = queueY[head];
        const cd = queueD[head];
        head++;
        if (cx === undefined || cy === undefined || cd === undefined) {
          throw new Error("addLoops: unreachable queue read");
        }
        if (cd > minPathDistance) return true;
        const nd = cd + 1;
        for (let k = 0; k < 4; k++) {
          const dx = DX4[k];
          const dy = DY4[k];
          if (dx === undefined || dy === undefined) {
            throw new Error("addLoops: unreachable DX4/DY4 read");
          }
          const nx = cx + dx;
          const ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          if (nx === bx && ny === by) continue;
          const ni = ny * W + nx;
          if (visited[ni] === 1) continue;
          const t = tiles[ni];
          if (t !== TILE_FLOOR && t !== TILE_DOOR) continue;
          if (nx === gx && ny === gy) return nd > minPathDistance;
          visited[ni] = 1;
          queueX[tail] = nx;
          queueY[tail] = ny;
          queueD[tail] = nd;
          tail++;
        }
      }
      // Goal unreachable without going through the blocker. The pre-check
      // guarantees the two endpoints are walkable, so this means the blocker
      // is the only existing connection — carving it is a meaningful loop.
      return true;
    };

    let added = 0;
    for (
      let attempt = 0;
      attempt < maxAttempts && added < maxLoops;
      attempt++
    ) {
      const x = rng.int(0, W - 1);
      const y = rng.int(0, H - 1);
      if (tiles[idx(x, y, W)] !== TILE_WALL) continue;

      // Candidate qualifies only if exactly one axis has floor on both sides
      // and the other axis has wall on both sides — i.e. a 1-cell-thick wall
      // between two walkable regions.
      const nWalkable = isWalkable(x, y - 1);
      const sWalkable = isWalkable(x, y + 1);
      const eWalkable = isWalkable(x + 1, y);
      const wWalkable = isWalkable(x - 1, y);
      const nsPair = nWalkable && sWalkable && !eWalkable && !wWalkable;
      const ewPair = eWalkable && wWalkable && !nWalkable && !sWalkable;
      if (!nsPair && !ewPair) continue;

      const startX = nsPair ? x : x - 1;
      const startY = nsPair ? y - 1 : y;
      const goalX = nsPair ? x : x + 1;
      const goalY = nsPair ? y + 1 : y;

      // We only care whether the existing path length exceeds the threshold,
      // not its exact value. Early-exit on the first cell popped with cd >
      // threshold makes most BFS calls bail out quickly.
      const exceedsThreshold = runBfs(startX, startY, goalX, goalY, x, y);
      if (!exceedsThreshold) continue;

      tiles[idx(x, y, W)] = TILE_DOOR;
      added++;
    }

    // Loops are not tied to a single pair of rooms (they create cycles in the
    // room graph), so we deliberately do NOT register them on any Room.doors
    // list. Renderers and pathfinders treat them as standalone door tiles on
    // the grid — that's enough.
    return {
      ...level,
      grid: { ...level.grid, tiles },
    };
  };
}
