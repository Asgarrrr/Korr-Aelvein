import { describe, expect, test } from "bun:test";
import { createRng } from "../../../../rng/index";
import { idx } from "../../../grid";
import { emptyLevel, runPipeline } from "../../../index";
import { type Level, TILE_FLOOR, TILE_WALL } from "../../../types";
import { connectComponents } from "../connect-components";
import { iterateCA } from "../iterate-ca";
import { placeCavernSpawn } from "../place-cavern-spawn";
import { seedCA } from "../seed-ca";

function buildConnectedCave(seed: number, w = 80, h = 30) {
  return runPipeline(emptyLevel(w, h), createRng(seed), [
    seedCA({ wallProbability: 0.45 }),
    iterateCA({ iterations: 5, birthLimit: 5, survivalLimit: 4 }),
    connectComponents,
  ]);
}

describe("placeCavernSpawn", () => {
  test("sets spawn to some TILE_FLOOR tile", () => {
    const base = buildConnectedCave(1);
    const out = placeCavernSpawn(base, createRng(100));
    expect(out.spawn).not.toBeNull();
    if (out.spawn === null) throw new Error("unreachable");
    const [x, y] = out.spawn;
    expect(out.grid.tiles[idx(x, y, out.grid.width)]).toBe(TILE_FLOOR);
  });

  test("does not modify tiles, rooms, or downStairs", () => {
    const base = buildConnectedCave(2);
    const beforeTiles = new Uint8Array(base.grid.tiles);
    const out = placeCavernSpawn(base, createRng(200));
    expect(Array.from(out.grid.tiles)).toEqual(Array.from(beforeTiles));
    expect(out.rooms).toEqual([]);
    expect(out.downStairs).toBeNull();
  });

  test("throws when there are no floor tiles", () => {
    const allWall: Level = (() => {
      const lvl = emptyLevel(10, 10);
      const tiles = new Uint8Array(lvl.grid.tiles);
      for (let i = 0; i < tiles.length; i++) tiles[i] = TILE_WALL;
      return { ...lvl, grid: { ...lvl.grid, tiles } };
    })();
    expect(() => placeCavernSpawn(allWall, createRng(0))).toThrow();
  });

  test("determinism: same seed → same spawn", () => {
    const base = buildConnectedCave(3);
    const a = placeCavernSpawn(base, createRng(300));
    const b = placeCavernSpawn(base, createRng(300));
    expect(a.spawn).toEqual(b.spawn);
  });

  test("different seeds typically produce different spawns", () => {
    // Statistical, but with thousands of floor tiles the collision rate of two
    // distinct rng streams is negligible. Asserting a single inequality keeps
    // this from being a flaky test, while still catching "spawn is constant".
    const base = buildConnectedCave(4);
    const a = placeCavernSpawn(base, createRng(1));
    const b = placeCavernSpawn(base, createRng(999));
    if (a.spawn === null || b.spawn === null) throw new Error("unreachable");
    const same = a.spawn[0] === b.spawn[0] && a.spawn[1] === b.spawn[1];
    expect(same).toBe(false);
  });

  test("does not mutate the input level", () => {
    const base = buildConnectedCave(5);
    const before = new Uint8Array(base.grid.tiles);
    placeCavernSpawn(base, createRng(500));
    for (let i = 0; i < before.length; i++) {
      expect(base.grid.tiles[i]).toBe(before[i] ?? -1);
    }
    expect(base.spawn).toBeNull();
  });
});
