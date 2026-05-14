import { DX4, DY4, makeBfsScratch } from "../../grid";
import { type Pass, TILE_DOOR, TILE_FLOOR } from "../../types";

export const placeCavernStairs: Pass = (level) => {
  if (level.spawn === null) {
    throw new Error(
      "placeCavernStairs: precondition violated — level.spawn is null (run placeCavernSpawn first)",
    );
  }
  const [sx, sy] = level.spawn;
  const { width: W, height: H, tiles } = level.grid;
  const { visited, queueX, queueY, queueD } = makeBfsScratch(W * H);

  queueX[0] = sx;
  queueY[0] = sy;
  queueD[0] = 0;
  visited[sy * W + sx] = 1;

  let head = 0;
  let tail = 1;
  let bestX = sx;
  let bestY = sy;
  let bestD = 0;

  // Do not refactor the inner expansion to a `visit()` closure that mutates
  // `tail` — measured ~3.7× slower than this inline `for-k` body across all
  // sizes (`bench/place-cavern-stairs.bench.ts`). JSC won't inline aggressively
  // when the closure captures a mutable counter.
  while (head < tail) {
    const cx = queueX[head];
    const cy = queueY[head];
    const cd = queueD[head];
    head++;
    if (cx === undefined || cy === undefined || cd === undefined) {
      throw new Error("placeCavernStairs: unreachable queue read");
    }
    if (cd > bestD) {
      bestD = cd;
      bestX = cx;
      bestY = cy;
    }
    const nd = cd + 1;
    for (let k = 0; k < 4; k++) {
      const dx = DX4[k];
      const dy = DY4[k];
      if (dx === undefined || dy === undefined) {
        throw new Error("placeCavernStairs: unreachable DX4/DY4 read");
      }
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const ni = ny * W + nx;
      if (visited[ni] === 1) continue;
      const t = tiles[ni];
      if (t !== TILE_FLOOR && t !== TILE_DOOR) continue;
      visited[ni] = 1;
      queueX[tail] = nx;
      queueY[tail] = ny;
      queueD[tail] = nd;
      tail++;
    }
  }

  if (bestD === 0) {
    throw new Error(
      "placeCavernStairs: degenerate level — BFS from spawn reached no other tile (run connectComponents first?)",
    );
  }

  return { ...level, downStairs: [bestX, bestY] };
};
