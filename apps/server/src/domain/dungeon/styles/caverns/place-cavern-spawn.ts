import { type Pass, TILE_FLOOR } from "../../types";

export const placeCavernSpawn: Pass = (level, rng) => {
  const { width: W, tiles } = level.grid;
  const cap = tiles.length;

  // Flat single-pass counts: JSC specialises Uint8Array indexed loads on a
  // counted `for-i` loop hard, and dropping the nested (y, x) shape + idx()
  // call shaves a real fraction of a ms at 200×100+.
  //
  // Determinism note: one `rng.int(0, count - 1)` draw, identical math to the
  // previous `rng.pick(floors)` (Math.floor(rng.next() * count)).
  let count = 0;
  for (let i = 0; i < cap; i++) {
    if (tiles[i] === TILE_FLOOR) count++;
  }
  if (count === 0) {
    throw new Error(
      "placeCavernSpawn: precondition violated — no floor tiles to spawn on",
    );
  }

  const target = rng.int(0, count - 1);
  let seen = 0;
  for (let i = 0; i < cap; i++) {
    if (tiles[i] !== TILE_FLOOR) continue;
    if (seen === target) {
      const x = i % W;
      const y = (i - x) / W;
      return { ...level, spawn: [x, y] };
    }
    seen++;
  }
  throw new Error(
    "placeCavernSpawn: unreachable — target index out of counted floor tiles",
  );
};
