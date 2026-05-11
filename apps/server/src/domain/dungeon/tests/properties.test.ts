// Adversarial / property tests for the Phase 0 dungeon foundation.
//
// These complement (not replace) the happy-path tests in grid.test.ts and
// index.test.ts: they bombard the API with seeded random inputs, hostile
// edge cases, and structural invariants a future change might silently break.
//
// Determinism: every "random" input here flows through createRng(seed) so
// failures are reproducible, per the project's RNG-as-infrastructure rule.

import { describe, expect, test } from "bun:test";
import { createRng } from "../../rng/index";
import {
  getTile,
  idx,
  inBounds,
  neighbors4,
  neighbors8,
  setTile,
} from "../grid";
import {
  emptyLevel,
  type Level,
  type Pass,
  type Pipeline,
  type Room,
  runPipeline,
  TILE_DOOR,
  TILE_FLOOR,
  TILE_WALL,
} from "../index";
import type { Grid, Tile } from "../types";

const TILES: ReadonlyArray<Tile> = [TILE_WALL, TILE_FLOOR, TILE_DOOR];

function makeGrid(width: number, height: number): Grid {
  return { width, height, tiles: new Uint8Array(width * height) };
}

function pickTile(rngFloat: number): Tile {
  const i = Math.floor(rngFloat * TILES.length);
  // i ∈ [0, 3); nthOrThrow-style narrowing to satisfy noUncheckedIndexedAccess
  // without `as`.
  for (const [j, t] of TILES.entries()) {
    if (j === i) return t;
  }
  throw new Error(`pickTile: index ${i} unreachable`);
}

// ─── A. Property tests ────────────────────────────────────────────────────────

describe("property: setTile/getTile round-trip is reflexive", () => {
  test("setTile(g, x, y, getTile(g, x, y)) preserves every cell", () => {
    const rng = createRng(0xa11ce);
    const w = 12;
    const h = 9;
    // Fill a grid with random tiles first so we have something to round-trip.
    let g: Grid = makeGrid(w, h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        g = setTile(g, x, y, pickTile(rng.next()));
      }
    }
    const before = new Uint8Array(g.tiles);
    // Re-write every cell with its own current value; nothing should change.
    let g2: Grid = g;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        g2 = setTile(g2, x, y, getTile(g2, x, y));
      }
    }
    expect(Array.from(g2.tiles)).toEqual(Array.from(before));
  });
});

describe("property: setTile is local (changes exactly one byte)", () => {
  test("over 200 random writes, only the targeted byte differs", () => {
    const rng = createRng(0x10ca1);
    const w = 17;
    const h = 11;
    let g: Grid = makeGrid(w, h);
    for (let i = 0; i < 200; i++) {
      const x = rng.int(0, w - 1);
      const y = rng.int(0, h - 1);
      const t = pickTile(rng.next());
      const before = new Uint8Array(g.tiles);
      const g2 = setTile(g, x, y, t);
      const target = idx(x, y, w);
      for (let k = 0; k < before.length; k++) {
        if (k === target) {
          expect(g2.tiles[k]).toBe(t);
        } else {
          expect(g2.tiles[k]).toBe(before[k]);
        }
      }
      g = g2;
    }
  });
});

describe("property: setTile does not mutate input grid", () => {
  test("input.tiles is byte-identical and reference-distinct from output.tiles", () => {
    const rng = createRng(0xbabe);
    for (let i = 0; i < 50; i++) {
      const w = rng.int(1, 20);
      const h = rng.int(1, 20);
      const g = makeGrid(w, h);
      // Seed grid with a marker so we can detect any mutation.
      for (let k = 0; k < g.tiles.length; k++) g.tiles[k] = 1;
      const snapshot = new Uint8Array(g.tiles);
      const x = rng.int(0, w - 1);
      const y = rng.int(0, h - 1);
      const g2 = setTile(g, x, y, TILE_DOOR);
      expect(Array.from(g.tiles)).toEqual(Array.from(snapshot));
      expect(g.tiles).not.toBe(g2.tiles);
    }
  });
});

describe("property: emptyLevel produces only TILE_WALL", () => {
  test("over many sizes up to 50x50, every byte is 0", () => {
    const rng = createRng(0xc0ffee);
    for (let i = 0; i < 30; i++) {
      const w = rng.int(1, 50);
      const h = rng.int(1, 50);
      const lvl = emptyLevel(w, h);
      expect(lvl.grid.tiles.length).toBe(w * h);
      for (const b of lvl.grid.tiles) expect(b).toBe(TILE_WALL);
      expect(lvl.rooms).toEqual([]);
    }
  });
});

describe("property: idx is injective and surjective onto [0, w*h)", () => {
  test("for sizes up to 50x50, idx(x, y, w) is a bijection to a contiguous range", () => {
    const rng = createRng(0xd00d);
    for (let trial = 0; trial < 20; trial++) {
      const w = rng.int(1, 50);
      const h = rng.int(1, 50);
      const seen = new Set<number>();
      let min = Number.POSITIVE_INFINITY;
      let max = Number.NEGATIVE_INFINITY;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const i = idx(x, y, w);
          seen.add(i);
          if (i < min) min = i;
          if (i > max) max = i;
        }
      }
      expect(seen.size).toBe(w * h);
      expect(min).toBe(0);
      expect(max).toBe(w * h - 1);
    }
  });
});

describe("property: neighbors4 / neighbors8 consistency", () => {
  test("neighbors4: all entries are at Manhattan distance 1, no duplicates, no self", () => {
    const rng = createRng(0xfeed);
    for (let i = 0; i < 50; i++) {
      const x = rng.int(-100, 100);
      const y = rng.int(-100, 100);
      const ns = neighbors4(x, y);
      expect(ns.length).toBe(4);
      const set = new Set<string>();
      for (const [nx, ny] of ns) {
        const dx = Math.abs(nx - x);
        const dy = Math.abs(ny - y);
        expect(dx + dy).toBe(1);
        expect(nx === x && ny === y).toBe(false);
        set.add(`${nx},${ny}`);
      }
      expect(set.size).toBe(4);
    }
  });

  test("neighbors8: all entries at Chebyshev distance 1, no duplicates, no self", () => {
    const rng = createRng(0xface);
    for (let i = 0; i < 50; i++) {
      const x = rng.int(-100, 100);
      const y = rng.int(-100, 100);
      const ns = neighbors8(x, y);
      expect(ns.length).toBe(8);
      const set = new Set<string>();
      for (const [nx, ny] of ns) {
        const dx = Math.abs(nx - x);
        const dy = Math.abs(ny - y);
        expect(Math.max(dx, dy)).toBe(1);
        expect(dx + dy).toBeGreaterThan(0);
        set.add(`${nx},${ny}`);
      }
      expect(set.size).toBe(8);
    }
  });

  test("neighbors4 is a strict subset of neighbors8", () => {
    const ns4 = new Set(neighbors4(3, 7).map(([x, y]) => `${x},${y}`));
    const ns8 = new Set(neighbors8(3, 7).map(([x, y]) => `${x},${y}`));
    for (const k of ns4) expect(ns8.has(k)).toBe(true);
  });
});

describe("property: runPipeline is a left-fold over passes", () => {
  test("sentinel order in level.rooms equals pipeline order, for random pipeline lengths", () => {
    const rng = createRng(0xbeef);
    for (let trial = 0; trial < 20; trial++) {
      const length = rng.int(0, 12);
      const tags: number[] = [];
      const pipeline: Pipeline = Array.from({ length }, () => {
        const tag = rng.int(0, 1_000_000);
        tags.push(tag);
        const sentinel: Room = { x: tag, y: 0, w: 1, h: 1, doors: [] };
        const pass: Pass = (l) => ({ ...l, rooms: [...l.rooms, sentinel] });
        return pass;
      });
      const out = runPipeline(emptyLevel(4, 4), createRng(0), pipeline);
      expect(out.rooms.length).toBe(length);
      expect(out.rooms.map((r) => r.x)).toEqual(tags);
    }
  });
});

describe("property: runPipeline does not leak state between calls", () => {
  test("the same pipeline applied to two fresh emptyLevels yields equal rooms arrays", () => {
    const pass: Pass = (l) => ({
      ...l,
      rooms: [...l.rooms, { x: 1, y: 2, w: 3, h: 4, doors: [] }],
    });
    const pipeline: Pipeline = [pass, pass, pass];
    const rng1 = createRng(7);
    const rng2 = createRng(7);
    const a = runPipeline(emptyLevel(8, 8), rng1, pipeline);
    const b = runPipeline(emptyLevel(8, 8), rng2, pipeline);
    expect(a.rooms).toEqual(b.rooms);
    // And the second invocation didn't see the first's tagged rooms.
    expect(a.rooms.length).toBe(3);
    expect(b.rooms.length).toBe(3);
  });
});

describe("property: hot-loop convention (bypassing setTile) is valid", () => {
  test("a pass that copies tiles + writes via idx produces a Level whose getTile agrees", () => {
    const rng = createRng(0xbaba);
    const w = 20;
    const h = 15;
    const writes: ReadonlyArray<readonly [number, number, Tile]> = Array.from(
      { length: 200 },
      () => {
        const x = rng.int(0, w - 1);
        const y = rng.int(0, h - 1);
        const t = pickTile(rng.next());
        const tuple: readonly [number, number, Tile] = [x, y, t];
        return tuple;
      },
    );
    const hotLoopPass: Pass = (l) => {
      const tiles = new Uint8Array(l.grid.tiles);
      for (const [x, y, t] of writes) {
        tiles[idx(x, y, l.grid.width)] = t;
      }
      return { ...l, grid: { ...l.grid, tiles } };
    };
    const out = runPipeline(emptyLevel(w, h), createRng(0), [hotLoopPass]);

    // Every byte is a valid tile value.
    for (const b of out.grid.tiles) {
      expect(b === 0 || b === 1 || b === 2).toBe(true);
    }
    // getTile agrees with the last write at each coordinate.
    const last = new Map<string, Tile>();
    for (const [x, y, t] of writes) last.set(`${x},${y}`, t);
    for (const [key, expected] of last.entries()) {
      const parts = key.split(",");
      const xs = parts[0];
      const ys = parts[1];
      if (xs === undefined || ys === undefined) {
        throw new Error("unreachable");
      }
      expect(getTile(out.grid, Number(xs), Number(ys))).toBe(expected);
    }
  });
});

// ─── B. Adversarial / suspicious-corner tests ─────────────────────────────────

describe("adversarial: very large dimensions", () => {
  test("emptyLevel(1000, 1000) allocates 1MB cleanly and is all walls", () => {
    const lvl = emptyLevel(1000, 1000);
    expect(lvl.grid.tiles.length).toBe(1_000_000);
    // Sample the corners and middle.
    expect(lvl.grid.tiles[0]).toBe(TILE_WALL);
    expect(lvl.grid.tiles[999_999]).toBe(TILE_WALL);
    expect(lvl.grid.tiles[500_500]).toBe(TILE_WALL);
  });

  test("emptyLevel(MAX_SAFE_INTEGER, 1) throws cleanly (Uint8Array rejects)", () => {
    expect(() => emptyLevel(Number.MAX_SAFE_INTEGER, 1)).toThrow();
  });

  test("emptyLevel(2**30, 2**30) throws cleanly (overflow / allocation failure)", () => {
    // width * height overflows i32 multiplication semantics; Uint8Array
    // ctor rejects either via length-too-big or out-of-memory. Either is fine —
    // we only care that it doesn't silently produce a corrupt level.
    expect(() => emptyLevel(2 ** 30, 2 ** 30)).toThrow();
  });
});

describe("adversarial: hand-crafted malformed Grid", () => {
  // These tests document the ACTUAL behaviour of the API when a caller
  // bypasses emptyLevel and constructs a Grid by hand with mismatched
  // tiles.length. The Grid type doesn't enforce the invariant, so this is
  // a real failure mode worth pinning.

  test("getTile on a grid with too-short tiles array: throws (undefined byte)", () => {
    // 4x4 grid claimed, but only 4 bytes. (0,0) works; in-bounds (3,3) -> undefined.
    const malformed: Grid = { width: 4, height: 4, tiles: new Uint8Array(4) };
    expect(getTile(malformed, 0, 0)).toBe(TILE_WALL);
    // The tile at idx 15 is undefined; isTile(undefined) is false; throws.
    expect(() => getTile(malformed, 3, 3)).toThrow();
  });

  test("setTile on a grid with too-short tiles array: out-of-range write is dropped silently by Uint8Array", () => {
    // Uint8Array writes past the end are no-ops in JS. This is a SILENT
    // corruption mode that the API does not detect — flagged in the report.
    const malformed: Grid = { width: 4, height: 4, tiles: new Uint8Array(4) };
    // setTile validates inBounds (which only looks at width/height), then
    // writes at idx 15 — past the end of the 4-byte array.
    const out = setTile(malformed, 3, 3, TILE_FLOOR);
    expect(out.tiles.length).toBe(4);
    // The write is silently dropped; reading back yields TILE_WALL.
    // This documents the bug; if this test starts failing because the API
    // grew a length check, that's a good sign — update the expectation.
    expect(getTile(out, 0, 0)).toBe(TILE_WALL);
  });

  test("getTile throws on corrupted byte (e.g., 99 or 255)", () => {
    const g = makeGrid(2, 2);
    g.tiles[0] = 99;
    expect(() => getTile(g, 0, 0)).toThrow();
    g.tiles[0] = 255;
    expect(() => getTile(g, 0, 0)).toThrow();
    g.tiles[0] = 3; // just past TILE_DOOR
    expect(() => getTile(g, 0, 0)).toThrow();
  });
});

describe("adversarial: float coordinates to inBounds", () => {
  // Documents the CURRENT behaviour. inBounds does only `<` / `>=` checks,
  // so `1.5` passes for a 5-wide grid. This is a pinning test, not an
  // endorsement — surfaced in the report.
  const grid = { width: 5, height: 4 };

  test("inBounds(1.5, 0, g) returns true (no integer check)", () => {
    expect(inBounds(1.5, 0, grid)).toBe(true);
  });

  test("inBounds(NaN, 0, g) returns false (NaN comparisons)", () => {
    expect(inBounds(Number.NaN, 0, grid)).toBe(false);
    expect(inBounds(0, Number.NaN, grid)).toBe(false);
  });

  test("inBounds(Infinity, 0, g) returns false", () => {
    expect(inBounds(Number.POSITIVE_INFINITY, 0, grid)).toBe(false);
    expect(inBounds(Number.NEGATIVE_INFINITY, 0, grid)).toBe(false);
  });
});

describe("adversarial: zero-dimension hand-crafted Grid", () => {
  test("inBounds on a 0x0 grid is always false", () => {
    const empty: Pick<Grid, "width" | "height"> = { width: 0, height: 0 };
    expect(inBounds(0, 0, empty)).toBe(false);
    expect(inBounds(-1, -1, empty)).toBe(false);
    expect(inBounds(1, 1, empty)).toBe(false);
  });

  test("getTile on a hand-crafted 0x0 grid always throws", () => {
    const empty: Grid = { width: 0, height: 0, tiles: new Uint8Array(0) };
    expect(() => getTile(empty, 0, 0)).toThrow();
  });
});

describe("adversarial: runPipeline pass behaviour", () => {
  test("a pass that throws: exception propagates, no swallowing", () => {
    const boom: Pass = () => {
      throw new Error("boom");
    };
    const lvl = emptyLevel(4, 4);
    const rng = createRng(0);
    expect(() => runPipeline(lvl, rng, [boom])).toThrow("boom");
  });

  test("a pass that throws on the second of three: first ran, third did not", () => {
    let firstRan = false;
    let thirdRan = false;
    const p1: Pass = (l) => {
      firstRan = true;
      return l;
    };
    const p2: Pass = () => {
      throw new Error("middle");
    };
    const p3: Pass = (l) => {
      thirdRan = true;
      return l;
    };
    const lvl = emptyLevel(4, 4);
    const rng = createRng(0);
    expect(() => runPipeline(lvl, rng, [p1, p2, p3])).toThrow("middle");
    expect(firstRan).toBe(true);
    expect(thirdRan).toBe(false);
  });

  test("a pass returning the same reference: subsequent passes still see correct state", () => {
    const same: Pass = (l) => l;
    const tag: Pass = (l) => ({
      ...l,
      rooms: [...l.rooms, { x: 9, y: 9, w: 1, h: 1, doors: [] }],
    });
    const lvl = emptyLevel(4, 4);
    const rng = createRng(0);
    const out = runPipeline(lvl, rng, [same, tag, same]);
    expect(out.rooms.length).toBe(1);
    const first = out.rooms[0];
    if (first === undefined) throw new Error("unreachable");
    expect(first.x).toBe(9);
  });

  test("1000 identity passes: no stack overflow (reduce is iterative)", () => {
    const identity: Pass = (l) => l;
    const pipeline: Pipeline = Array.from({ length: 1000 }, () => identity);
    const lvl = emptyLevel(4, 4);
    const rng = createRng(0);
    const out = runPipeline(lvl, rng, pipeline);
    expect(out).toBe(lvl);
  });

  test("each pass receives the SAME rng instance (shared state across passes)", () => {
    // Worth pinning: runPipeline does not split the rng per pass, so
    // sequential passes share one stream. Future me might be tempted to
    // refactor; this test catches that silently changing the contract.
    const seen: number[] = [];
    const observePass: Pass = (l, r) => {
      seen.push(r.next());
      return l;
    };
    const lvl = emptyLevel(4, 4);
    const rng = createRng(0xfacefeed);
    runPipeline(lvl, rng, [observePass, observePass, observePass]);

    // Compare to a single rng draining 3 values.
    const reference = createRng(0xfacefeed);
    const expected = [reference.next(), reference.next(), reference.next()];
    expect(seen).toEqual(expected);
  });
});

describe("adversarial: Level immutability across runPipeline", () => {
  test("input level.grid.tiles is not mutated by passes that build new arrays", () => {
    const lvl = emptyLevel(8, 8);
    const before = new Uint8Array(lvl.grid.tiles);
    const fillPass: Pass = (l) => {
      const tiles = new Uint8Array(l.grid.tiles);
      tiles.fill(TILE_FLOOR);
      return { ...l, grid: { ...l.grid, tiles } };
    };
    const out: Level = runPipeline(lvl, createRng(0), [fillPass]);
    expect(Array.from(lvl.grid.tiles)).toEqual(Array.from(before));
    expect(out.grid.tiles).not.toBe(lvl.grid.tiles);
    for (const b of out.grid.tiles) expect(b).toBe(TILE_FLOOR);
  });
});
