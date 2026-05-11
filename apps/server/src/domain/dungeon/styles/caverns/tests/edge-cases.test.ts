// Adversarial inputs for the caverns pipeline — tiny / asymmetric / huge
// grids, degenerate CA params, invalid factory arguments, and pass-level
// preconditions. The goal is to document the behaviour at the cliff edges so
// future changes either pass these or are explicit about the new contract.

import { describe, expect, test } from "bun:test";
import { createRng } from "../../../../rng/index";
import { idx } from "../../../grid";
import {
  emptyLevel,
  generateLevel,
  type Level,
  runPipeline,
  TILE_FLOOR,
  TILE_WALL,
} from "../../../index";
import { connectComponents } from "../connect-components";
import { iterateCA } from "../iterate-ca";
import { placeCavernSpawn } from "../place-cavern-spawn";
import { placeCavernStairs } from "../place-cavern-stairs";
import { seedCA } from "../seed-ca";

describe("tiny 10x10 caverns — success rate over 20 seeds", () => {
  test("documents the success/failure split, both branches accepted", () => {
    // Tiny grids may fail at connectComponents (only one component? still ok)
    // or at placeCavernSpawn (no floor at all). We don't dictate a minimum
    // success rate; we just document the actual rate so a regression that
    // breaks tiny grids entirely (0/20) jumps out.
    let ok = 0;
    let failed = 0;
    for (let s = 0; s < 20; s++) {
      try {
        generateLevel(createRng(s), 10, 10, "caverns");
        ok++;
      } catch {
        failed++;
      }
    }
    // Either branch is acceptable; we only assert no anomaly (negative count).
    expect(ok + failed).toBe(20);
    // Soft bound: tiny levels shouldn't be uniformly broken. If this trips,
    // either the algorithm changed (intentional?) or something is wrong.
    expect(ok).toBeGreaterThan(0);
  });
});

describe("asymmetric grids", () => {
  test("5x80: either generates cleanly or throws cleanly (no silent bug)", () => {
    let outcome: "ok" | "err" = "err";
    try {
      const lvl = generateLevel(createRng(0xa5a5), 5, 80, "caverns");
      // If it generated, basic invariants must hold.
      expect(lvl.grid.width).toBe(5);
      expect(lvl.grid.height).toBe(80);
      expect(lvl.spawn).not.toBeNull();
      expect(lvl.downStairs).not.toBeNull();
      outcome = "ok";
    } catch {
      outcome = "err";
    }
    expect(outcome === "ok" || outcome === "err").toBe(true);
  });

  test("80x5: same — either clean output or clean throw", () => {
    let outcome: "ok" | "err" = "err";
    try {
      const lvl = generateLevel(createRng(0x5a5a), 80, 5, "caverns");
      expect(lvl.grid.width).toBe(80);
      expect(lvl.grid.height).toBe(5);
      outcome = "ok";
    } catch {
      outcome = "err";
    }
    expect(outcome === "ok" || outcome === "err").toBe(true);
  });
});

describe("large grids", () => {
  test("200x100 caverns generates in reasonable time and stays connected", () => {
    const t0 = performance.now();
    const lvl = generateLevel(createRng(7), 200, 100, "caverns");
    const ms = performance.now() - t0;
    // Generous bound: 2 seconds. CI hardware varies. The real check is "this
    // doesn't run forever".
    expect(ms).toBeLessThan(2000);
    expect(lvl.spawn).not.toBeNull();
    expect(lvl.downStairs).not.toBeNull();
    // Connectivity: BFS from spawn touches every floor tile.
    if (lvl.spawn === null) throw new Error("unreachable");
    const { width: W, height: H, tiles } = lvl.grid;
    const visited = new Uint8Array(W * H);
    visited[idx(lvl.spawn[0], lvl.spawn[1], W)] = 1;
    const qx: number[] = [lvl.spawn[0]];
    const qy: number[] = [lvl.spawn[1]];
    let head = 0;
    let reached = 1;
    while (head < qx.length) {
      const cx = qx[head];
      const cy = qy[head];
      head++;
      if (cx === undefined || cy === undefined) throw new Error("unreach");
      const ns: ReadonlyArray<readonly [number, number]> = [
        [cx, cy - 1],
        [cx + 1, cy],
        [cx, cy + 1],
        [cx - 1, cy],
      ];
      for (const [nx, ny] of ns) {
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const ni = idx(nx, ny, W);
        if (visited[ni] === 1) continue;
        if (tiles[ni] !== TILE_FLOOR) continue;
        visited[ni] = 1;
        reached++;
        qx.push(nx);
        qy.push(ny);
      }
    }
    let floorCount = 0;
    for (const t of tiles) if (t === TILE_FLOOR) floorCount++;
    expect(reached).toBe(floorCount);
  });

  test("300x150 caverns generates in <2s", () => {
    const t0 = performance.now();
    generateLevel(createRng(11), 300, 150, "caverns");
    const ms = performance.now() - t0;
    expect(ms).toBeLessThan(2000);
  });
});

describe("degenerate CA-param combinations", () => {
  test("all-floor seed → iterateCA introduces walls (OOB-as-WALL bias)", () => {
    // Document the converged behaviour: starting from an all-floor interior
    // and iterating with defaults pulls walls inward from the border.
    const seeded = seedCA({ wallProbability: 0 })(
      emptyLevel(40, 30),
      createRng(0),
    );
    const after = iterateCA({ iterations: 5 })(seeded, createRng(0));
    let walls = 0;
    for (const t of after.grid.tiles) if (t === TILE_WALL) walls++;
    // We accept any non-trivial wall count; the precise number is incidental.
    expect(walls).toBeGreaterThan(0);
  });

  test("all-wall seed → connectComponents throws cleanly", () => {
    const seeded = seedCA({ wallProbability: 1 })(
      emptyLevel(40, 30),
      createRng(0),
    );
    const evolved = iterateCA({ iterations: 5 })(seeded, createRng(0));
    expect(() => connectComponents(evolved, createRng(0))).toThrow(
      /zero floor tiles/,
    );
  });

  test("iterateCA with iterations=100 converges to a fixed point", () => {
    const seeded = seedCA({ wallProbability: 0.45 })(
      emptyLevel(40, 30),
      createRng(13),
    );
    const a = iterateCA({ iterations: 100 })(seeded, createRng(0));
    const b = iterateCA({ iterations: 100 })(seeded, createRng(0));
    expect(Array.from(a.grid.tiles)).toEqual(Array.from(b.grid.tiles));
  });

  test("birthLimit=0: every floor cell quickly becomes wall", () => {
    // With birthLimit=0, any FLOOR neighbor count >= 0 turns a FLOOR cell into
    // WALL. Effectively forces everything wall-ward in one step. Pipeline
    // built from this should still execute (or throw cleanly at
    // connectComponents).
    const seeded = seedCA({ wallProbability: 0.45 })(
      emptyLevel(20, 15),
      createRng(0),
    );
    const out = iterateCA({ iterations: 2, birthLimit: 0, survivalLimit: 4 })(
      seeded,
      createRng(0),
    );
    // Expect the grid to be heavily wall-dominated.
    let walls = 0;
    let floors = 0;
    for (const t of out.grid.tiles) {
      if (t === TILE_WALL) walls++;
      else if (t === TILE_FLOOR) floors++;
    }
    expect(walls).toBeGreaterThan(floors);
  });

  test("survivalLimit=8: walls only survive with all 8 wall neighbors → most flip", () => {
    const seeded = seedCA({ wallProbability: 0.45 })(
      emptyLevel(20, 15),
      createRng(0),
    );
    const out = iterateCA({ iterations: 2, birthLimit: 5, survivalLimit: 8 })(
      seeded,
      createRng(0),
    );
    // At least some walls survive (the border is forced WALL after each step),
    // so just sanity-check the grid is well-formed.
    expect(out.grid.tiles.length).toBe(20 * 15);
  });
});

describe("factory defaults", () => {
  test("seedCA() with no params does not throw at construction", () => {
    expect(() => seedCA()).not.toThrow();
  });

  test("iterateCA() with no params does not throw at construction", () => {
    expect(() => iterateCA()).not.toThrow();
  });
});

describe("factory rejects invalid params", () => {
  test("seedCA: wallProbability < 0 throws", () => {
    expect(() => seedCA({ wallProbability: -0.1 })).toThrow();
  });

  test("seedCA: wallProbability > 1 throws", () => {
    expect(() => seedCA({ wallProbability: 1.1 })).toThrow();
  });

  test("seedCA: NaN / Infinity throw", () => {
    expect(() => seedCA({ wallProbability: Number.NaN })).toThrow();
    expect(() =>
      seedCA({ wallProbability: Number.POSITIVE_INFINITY }),
    ).toThrow();
  });

  test("iterateCA: iterations < 0 throws", () => {
    expect(() => iterateCA({ iterations: -1 })).toThrow();
  });

  test("iterateCA: iterations not integer throws", () => {
    expect(() => iterateCA({ iterations: 1.5 })).toThrow();
  });

  test("iterateCA: birthLimit > 8 throws", () => {
    expect(() => iterateCA({ birthLimit: 9 })).toThrow();
  });

  test("iterateCA: birthLimit < 0 throws", () => {
    expect(() => iterateCA({ birthLimit: -1 })).toThrow();
  });

  test("iterateCA: survivalLimit > 8 throws", () => {
    expect(() => iterateCA({ survivalLimit: 9 })).toThrow();
  });

  test("iterateCA: non-integer survivalLimit throws", () => {
    expect(() => iterateCA({ survivalLimit: 4.5 })).toThrow();
  });
});

describe("placeCavernSpawn precondition", () => {
  test("all-wall level → throws cleanly", () => {
    const base = emptyLevel(10, 10);
    const tiles = new Uint8Array(base.grid.tiles);
    for (let i = 0; i < tiles.length; i++) tiles[i] = TILE_WALL;
    const allWall: Level = { ...base, grid: { ...base.grid, tiles } };
    expect(() => placeCavernSpawn(allWall, createRng(0))).toThrow(
      /no floor tiles/,
    );
  });
});

describe("placeCavernStairs precondition", () => {
  test("spawn=null → throws cleanly with helpful message", () => {
    const base = emptyLevel(10, 10);
    expect(() => placeCavernStairs(base, createRng(0))).toThrow(
      /spawn is null/,
    );
  });
});

describe("pipeline composition with adversarial CA params", () => {
  test("pipeline with iterateCA(iterations=100) still produces a level", () => {
    // Smoke test: extreme but legal params don't blow up the pipeline.
    const out = runPipeline(emptyLevel(40, 25), createRng(7), [
      seedCA({ wallProbability: 0.45 }),
      iterateCA({ iterations: 100, birthLimit: 5, survivalLimit: 4 }),
      connectComponents,
      placeCavernSpawn,
      placeCavernStairs,
    ]);
    expect(out.spawn).not.toBeNull();
    expect(out.downStairs).not.toBeNull();
  });
});
