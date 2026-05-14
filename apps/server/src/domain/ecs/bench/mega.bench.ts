/**
 * Mega-scale baseline — pushes every axis to scales no realistic game tick
 * will reach (10k → 100k entities). Run with `bun run bench:ecs:mega`.
 *
 * After the sparse-set migration the world build is O(N) not O(N²), so 100k
 * setup is ~100ms instead of ~30s.
 *
 * BENCH HYGIENE: each scenario builds a FRESH world. Without this, A1's
 * spawn iters would leak into A3/A5's measurements — we'd be measuring
 * "query a (N + iters)-entity world" instead of "query an N-entity world".
 */
import {
  type EntityHandle,
  emptyWorld,
  forQuery,
  query,
  setComponent,
  spawn,
  type World,
} from "../index";

// ─── Harness ─────────────────────────────────────────────────────────────────

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
  const warmup = Math.min(Math.max(iters >> 4, 5), 100);
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

const SCALES: readonly number[] = [10_000, 50_000, 100_000];

function itersFor(n: number, kind: "mutate" | "query" | "batch"): number {
  if (kind === "mutate") return 10_000;
  if (kind === "query") {
    if (n <= 10_000) return 500;
    if (n <= 50_000) return 100;
    return 50;
  }
  if (n <= 10_000) return 100;
  if (n <= 50_000) return 30;
  return 10;
}

export function runAll(): readonly Result[] {
  const rows: Result[] = [];

  for (const n of SCALES) {
    console.log(`\n── N = ${n.toLocaleString()} ────────────────────`);

    // A1 — spawn one more onto fresh world. 200k iters → ~10ms measurement
    // window, swamps timer noise. Spawn is amortized O(1) — the world grows
    // by 200k during the bench but per-op cost stays representative.
    {
      const setupStart = performance.now();
      const { world } = buildWorldN(n);
      console.log(
        `  setup A1: ${(performance.now() - setupStart).toFixed(0)} ms`,
      );
      rows.push(
        bench("A1 spawn (one onto N)", n, 200_000, () => {
          spawn(world, { position: { x: 1, y: 1 } });
        }),
      );
    }

    // A2 — setComponent on a known handle. 1M iters because the op is < 10ns
    // and a 10k-iter window leaves a 100µs measurement that's pure timer
    // noise (CV > 100% observed at N=100k).
    {
      const { world, handles } = buildWorldN(n);
      const h0 = handles[0];
      if (h0 === undefined) throw new Error("bench: missing handle 0");
      rows.push(
        bench("A2 setComponent (one on N)", n, 1_000_000, () => {
          setComponent(world, h0, "position", { x: 9, y: 9 });
        }),
      );
    }

    // A3 — full single-key query.
    {
      const { world } = buildWorldN(n);
      rows.push(
        bench("A3 query[position]", n, itersFor(n, "query"), () => {
          for (const _ of query(world, ["position"])) {
            // pure iteration + projection alloc
          }
        }),
      );
    }

    // A4 — multi-key query 50% selectivity.
    {
      const halfWorld = buildWorldHalfHP(n);
      rows.push(
        bench(
          "A4 query[position,hp] @ 50% match",
          n,
          itersFor(n, "query"),
          () => {
            for (const _ of query(halfWorld, ["position", "hp"])) {
              // ditto
            }
          },
        ),
      );
    }

    // A5 — batch update.
    {
      const { world } = buildWorldN(n);
      rows.push(
        bench("A5 batch update all positions", n, itersFor(n, "batch"), () => {
          for (const [h, e] of query(world, ["position"])) {
            setComponent(world, h, "position", {
              x: e.position.x + 1,
              y: e.position.y,
            });
          }
        }),
      );
    }

    // A6 — tick (mutate half).
    {
      const { world } = buildWorldN(n);
      rows.push(
        bench("A6 tick (mutate half)", n, itersFor(n, "batch"), () => {
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

    // A7 — A3 via forQuery (zero per-entity alloc).
    {
      const { world } = buildWorldN(n);
      rows.push(
        bench("A7 forQuery[position]", n, itersFor(n, "query"), () => {
          forQuery(world, ["position"], (_h, _v) => {
            // pure iteration with reused refs
          });
        }),
      );
    }

    // A8 — A5 via forQuery.
    {
      const { world } = buildWorldN(n);
      rows.push(
        bench("A8 forQuery batch update", n, itersFor(n, "batch"), () => {
          forQuery(world, ["position"], (h, e) => {
            setComponent(world, h, "position", {
              x: e.position.x + 1,
              y: e.position.y,
            });
          });
        }),
      );
    }
  }

  return rows;
}

// ─── Entry ────────────────────────────────────────────────────────────────────

if (import.meta.main) {
  console.log("\nECS bench — MEGA scale (sparse-set, mutable in-place)\n");
  const results = runAll();
  console.log();
  console.log(formatTable(results));
  console.log();
}
