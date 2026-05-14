/**
 * Quantified baseline for every axis in our ECS trade-offs table. Run with
 * `bun run bench:ecs` from `apps/server/`. Not part of CI — use locally
 * before and after a perf optimisation to verify the win.
 *
 * Post sparse-set migration: most operations are O(1) (spawn, setComponent
 * use Map.set on the sparse index + array push). Queries are O(n_pivot)
 * where n_pivot = size of the smallest matching column. The wall is now
 * the projection-alloc per yield, not the storage clone.
 *
 * BENCH HYGIENE: each scenario builds a FRESH world. Without this, A1's
 * 200k spawns would leak into A3/A5's measurements — we'd be measuring
 * "query a 200k-entity world" instead of "query an N-entity world". The
 * setup cost (one `buildWorldN(n)` per scenario) is dwarfed by the
 * measurement loop.
 *
 * Scenarios mirror axis numbers from the trade-offs review:
 *   A1  spawn               (axis #1 — was Map clone, now O(1))
 *   A2  setComponent        (axis #1 — was Map clone, now O(1))
 *   A3  query single-key    (axes #2 #7 — iteration + projection alloc)
 *   A4  query multi-key     (axes #2 #3 — pivot selection + projection)
 *   A5  batch update        (axis #6 — was O(n²), now O(n))
 *   A6  full tick           (composite — read all positions, mutate half)
 */
import {
  type EntityHandle,
  emptyWorld,
  forQuery,
  forQueryFiltered,
  query,
  setComponent,
  spawn,
  type World,
} from "../index";

// ─── Harness ──────────────────────────────────────────────────────────────────

export type Result = {
  readonly scenario: string;
  readonly n: number;
  readonly iters: number;
  readonly nsPerOp: number;
  readonly opsPerSec: number;
};

function bench(
  scenario: string,
  n: number,
  iters: number,
  fn: () => void,
): Result {
  const warmup = Math.min(Math.max(iters >> 4, 100), 5_000);
  for (let i = 0; i < warmup; i++) fn();

  const start = performance.now();
  for (let i = 0; i < iters; i++) fn();
  const elapsed = performance.now() - start;

  const nsPerOp = (elapsed * 1_000_000) / iters;
  const opsPerSec = (iters / elapsed) * 1000;
  return { scenario, n, iters, nsPerOp, opsPerSec };
}

function formatTable(rows: readonly Result[]): string {
  const header =
    "scenario                              N    iters       ns/op           ops/s";
  const sep =
    "─────────────────────────────────────────────────────────────────────────────";
  const lines = rows.map((r) => {
    const sc = r.scenario.padEnd(34);
    const n = String(r.n).padStart(6);
    const it = r.iters.toLocaleString().padStart(10);
    const ns = r.nsPerOp.toFixed(1).padStart(12);
    const ops = Math.round(r.opsPerSec).toLocaleString().padStart(15);
    return `${sc}${n}${it}${ns}${ops}`;
  });
  return [header, sep, ...lines].join("\n");
}

// ─── Fixtures ────────────────────────────────────────────────────────────────

function buildWorldN(n: number): {
  readonly world: World;
  readonly handles: readonly EntityHandle[];
} {
  const world = emptyWorld();
  const handles: EntityHandle[] = [];
  for (let i = 0; i < n; i++) {
    handles.push(
      spawn(world, {
        position: { x: i % 80, y: Math.floor(i / 80) },
        actor: { glyph: "x", name: `e${i}` },
        hp: { current: 10, max: 10 },
      }),
    );
  }
  return { world, handles };
}

// Mix where only half the entities carry `hp` — used to test query pivot
// selection (the smaller `hp` column should be the pivot when both keys
// are requested).
function buildWorldHalfHP(n: number): World {
  const w = emptyWorld();
  for (let i = 0; i < n; i++) {
    if (i % 2 === 0) {
      spawn(w, {
        position: { x: i % 80, y: Math.floor(i / 80) },
        hp: { current: 10, max: 10 },
      });
    } else {
      spawn(w, { position: { x: i % 80, y: Math.floor(i / 80) } });
    }
  }
  return w;
}

// ─── Scenarios ───────────────────────────────────────────────────────────────

const SCALES: readonly number[] = [50, 500, 5000];

function pickIters(n: number, fast: number, med: number, slow: number): number {
  if (n <= 50) return fast;
  if (n <= 500) return med;
  return slow;
}

export function runAll(): readonly Result[] {
  const rows: Result[] = [];

  for (const n of SCALES) {
    // A1 — spawn one more entity onto a fresh world of N. Iters bumped to
    // 200k so the measurement window (~8ms at 40 ns/op) overwhelms timer
    // noise. The world grows by 200k during the bench; spawn is amortized
    // O(1) so per-op cost stays representative of spawn-at-N.
    {
      const { world } = buildWorldN(n);
      rows.push(
        bench("A1 spawn (one onto N)", n, 200_000, () => {
          spawn(world, { position: { x: 1, y: 1 } });
        }),
      );
    }

    // A2 — setComponent on a known handle. Replaces in-place — does not grow
    // the world, safe to iter many times on the same world.
    {
      const { world, handles } = buildWorldN(n);
      const h0 = handles[0];
      if (h0 === undefined) throw new Error("bench: missing handle 0");
      rows.push(
        bench("A2 setComponent (one on N)", n, 500_000, () => {
          setComponent(world, h0, "position", { x: 9, y: 9 });
        }),
      );
    }

    // A3 — full single-key query, read-only. Safe to repeat on the same world.
    {
      const { world } = buildWorldN(n);
      const a3Iters = pickIters(n, 20_000, 5_000, 1_000);
      rows.push(
        bench("A3 query[position]", n, a3Iters, () => {
          for (const _ of query(world, ["position"])) {
            // measure pure iteration + projection alloc
          }
        }),
      );
    }

    // A4 — multi-key query 50% selectivity. Pivot picks the smaller column,
    // sparse-checks the other key.
    {
      const halfWorld = buildWorldHalfHP(n);
      const a4Iters = pickIters(n, 30_000, 8_000, 2_000);
      rows.push(
        bench("A4 query[position,hp] @ 50% match", n, a4Iters, () => {
          for (const _ of query(halfWorld, ["position", "hp"])) {
            // ditto
          }
        }),
      );
    }

    // A5 — batch update: query all, setComponent each. Replaces positions
    // in-place — does not grow the world. Safe to iter on the same world.
    {
      const { world } = buildWorldN(n);
      const a5Iters = pickIters(n, 5_000, 1_000, 200);
      rows.push(
        bench("A5 batch update all positions", n, a5Iters, () => {
          for (const [h, e] of query(world, ["position"])) {
            setComponent(world, h, "position", {
              x: e.position.x + 1,
              y: e.position.y,
            });
          }
        }),
      );
    }

    // A6 — composite tick: read all positions, mutate half. Same hygiene.
    {
      const { world } = buildWorldN(n);
      const a6Iters = pickIters(n, 5_000, 1_000, 200);
      rows.push(
        bench("A6 tick (mutate half)", n, a6Iters, () => {
          let i = 0;
          for (const [h, e] of query(world, ["position"])) {
            if ((i++ & 1) === 0) {
              setComponent(world, h, "position", {
                x: e.position.x + 1,
                y: e.position.y,
              });
            }
          }
        }),
      );
    }

    // A7 — same body as A3, but via the zero-alloc `forQuery` callback API.
    // Pair-compare with A3 to read the cost paid by the generator's per-yield
    // handle + view allocation. Note: in a single process the cb call site is
    // monomorphic to this benchmark's callback ⇒ no megamorphic confound.
    {
      const { world } = buildWorldN(n);
      const a7Iters = pickIters(n, 20_000, 5_000, 1_000);
      rows.push(
        bench("A7 forQuery[position]", n, a7Iters, () => {
          forQuery(world, ["position"], (_h, _v) => {
            // measure pure iteration with reused refs
          });
        }),
      );
    }

    // A8 — A5 via forQuery. Batch update all positions; the cost we want to
    // see drop is the per-entity projection allocation.
    {
      const { world } = buildWorldN(n);
      const a8Iters = pickIters(n, 5_000, 1_000, 200);
      rows.push(
        bench("A8 forQuery batch update", n, a8Iters, () => {
          forQuery(world, ["position"], (h, e) => {
            setComponent(world, h, "position", {
              x: e.position.x + 1,
              y: e.position.y,
            });
          });
        }),
      );
    }

    // A9 — forQuery with a `with: ["hp"]` filter. Every entity in buildWorldN
    // carries hp, so the filter matches 100% — worst-case overhead measurement
    // (every entity pays the has-check, none are short-circuited). Pair-compare
    // with A7 to read the filter cost.
    {
      const { world } = buildWorldN(n);
      const a9Iters = pickIters(n, 20_000, 5_000, 1_000);
      rows.push(
        bench("A9 forQuery[position] with[hp]", n, a9Iters, () => {
          forQueryFiltered(world, ["position"], { with: ["hp"] }, (_h, _v) => {
            // measure filter overhead vs A7
          });
        }),
      );
    }
  }

  return rows;
}

// ─── Entry ────────────────────────────────────────────────────────────────────

if (import.meta.main) {
  console.log("\nECS bench — baseline (sparse-set, mutable in-place)\n");
  const results = runAll();
  console.log(formatTable(results));
  console.log();
}
