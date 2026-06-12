/**
 * Discovery bench for `toSnapshot` (`app.ts`) — the WS-bound snapshot
 * built per accepted tick and pushed to the client. Two questions to
 * answer, no optimization yet:
 *
 *   Q1  How long does `toSnapshot()` take per call at our actual scales?
 *   Q2  How many bytes does the JSON-encoded payload weigh on the wire?
 *
 * The answer decides whether the full→delta-snapshot protocol pass
 * (~3h of work: schema split, diff-handler, client consumer rewrite,
 * variants + parity) is worth shipping or if the cost is already in
 * the noise.
 *
 * Scales:
 *   - "newGame" — donjon active (80×30, 2 wanderers, ~rim rooms count),
 *     village dormant (40×20, 1 shopkeeper). The realistic starting state.
 *   - "donjon-stress" — same donjon, +98 extra ai-bearing entities spawned
 *     onto free floor cells. Tests the mob-loop scaling.
 *   - "midgame" — newGame + 50 WAIT ticks, so the wanderer positions have
 *     drifted and the heap has churn. Catches any per-call cost that
 *     depends on heap state rather than just world state.
 *
 * Hygiene: each scenario rebuilds its starting state in setup (outside
 * the measurement window). The measurement loop calls `toSnapshot(state)`
 * repeatedly on the same `state` — `toSnapshot` is pure-on-input (reads
 * world, allocates a fresh literal), so repeated calls don't mutate.
 *
 * ── Payload change note (2026-06, Phase 7 perception) ─────────────────────
 *
 *   The wire format changed after the 2026-05 table was measured: tiles
 *   are perception-masked (unseen cells ship as 255 — 3 chars each, vs 1
 *   for a raw tile), mobs are FOV-filtered, and `spawn` + `rooms` were
 *   removed from the schema. Post-perception baseline (30-run aggregate,
 *   2026-06):
 *
 *   scenario                         median µs   payload (B)
 *   S1 newGame                          33.9        9 607
 *   S2 midgame                          33.9        9 608
 *   S3 100 mobs                         38.2        9 607
 *   S4 1000 mobs (pathological)         80.9       10 334
 *
 *   Per call: 1.6× the 2026-05 numbers (mask loop over 2 400 tiles +
 *   per-mob FOV probe) — under the 2× investigation bar, absolute cost
 *   still trivial at human action rates. Payload: +3.2 KB at S1 (the
 *   "255" inflation minus the rooms removal); S4 collapsed 33.4 → 10.3 KB
 *   because out-of-FOV mobs no longer ship. Compare future runs against
 *   THIS table, not the 2026-05 one.
 *
 * ── Discovery results (30-run aggregate, 2026-05, pre-perception) ─────────
 *
 *   scenario                         median µs    p95 µs   payload (B)
 *   S1 newGame (80×30, 2 mobs)         21.1       22.2         6 393
 *   S2 midgame (80×30, 2 mobs, t=50)   21.2       22.1         6 394
 *   S3 100 mobs                        24.1       25.4         9 019
 *   S4 1000 mobs (pathological)        51.2       52.6        33 407
 *
 *   CV ≤ 1.8 % on every scenario — numbers are stable, not noise.
 *
 * ── Verdict: DEFER the full→delta-snapshot protocol pass ──────────────────
 *
 *   At our realistic scale (S1/S2):
 *     - Server CPU per accepted action: 21 µs.
 *     - Turn-based + single-player + human action rate (~1-2/sec) means
 *       server-side load is ~42 µs/sec = 0.0026 % of a 16 ms frame.
 *     - Wire payload: 6.4 KB × 2/sec ≈ 100 kbps. Trivial on any link.
 *
 *   The payload breakdown (S3 vs S1: +98 mobs adds 2.6 KB) shows ~94 % of
 *   each tick is static-per-zone: tiles (~4.8 KB JSON for 80×30 × 1-char
 *   values + commas) + rooms-with-doors clone (~1 KB) + scaffolding. The
 *   delta-snapshot pass would cut payload by ~95 % and per-tick CPU by
 *   ~80 % — *real* wins on a percentage basis, but the absolute floor is
 *   already so low that the work is premature.
 *
 *   Re-evaluate this verdict when ANY of these trigger:
 *
 *     T1  Grid scales to 200×100 or 300×150 (rim's reference max).
 *         Payload would 6×–10× linearly, pushing past 40-60 KB/tick.
 *     T2  Multi-player support arrives. Each connected client multiplies
 *         the per-tick CPU cost; current 21 µs becomes 21 µs × N players.
 *     T3  Realtime action rate replaces the turn-based loop (e.g. an
 *         action-roguelike fork). 60-fps means 21 µs × 60 = 1.26 ms/sec
 *         per client — still small but a real multiplier.
 *     T4  Mobile / slow-connection target appears. 6.4 KB / action is
 *         fine on broadband, painful on 2G.
 *     T5  V8 / Bun heap profile shows the snapshot alloc as a top-5 GC
 *         pressure source.
 *
 *   Until then, the bench infrastructure stays as a regression check —
 *   re-run `bun run bench:snapshot:agg` before merging anything that
 *   changes `toSnapshot`, `responseSchema`, or the snapshot consumer in
 *   the client. A 2× regression here is a real concern; a 10 % drift is
 *   noise.
 */

import { type Snapshot, toSnapshot } from "../app";
import { spawn } from "../domain/ecs/index";
import {
  activeWorld,
  type GameState,
  newGame,
  tick,
} from "../domain/game/index";
import { fromRngState } from "../domain/rng/index";

// ─── Harness ──────────────────────────────────────────────────────────────────

type Result = {
  readonly scenario: string;
  readonly iters: number;
  readonly nsPerOp: number;
  readonly payloadBytes: number;
};

function bench(scenario: string, iters: number, state: GameState): Result {
  const warmup = Math.min(Math.max(iters >> 4, 100), 5_000);
  for (let i = 0; i < warmup; i++) toSnapshot(state);

  const start = performance.now();
  for (let i = 0; i < iters; i++) toSnapshot(state);
  const elapsed = performance.now() - start;

  const nsPerOp = (elapsed * 1_000_000) / iters;
  const snap: Snapshot = toSnapshot(state);
  const payloadBytes = JSON.stringify(snap).length;

  return { scenario, iters, nsPerOp, payloadBytes };
}

function formatTable(rows: readonly Result[]): string {
  const header =
    "scenario                                  iters       ns/op    payload (B)";
  const sep =
    "──────────────────────────────────────────────────────────────────────────";
  const lines = rows.map((r) => {
    const sc = r.scenario.padEnd(40);
    const it = r.iters.toLocaleString().padStart(10);
    const ns = r.nsPerOp.toFixed(1).padStart(12);
    const bytes = r.payloadBytes.toLocaleString().padStart(13);
    return `${sc}${it}${ns}${bytes}`;
  });
  return [header, sep, ...lines].join("\n");
}

// ─── Fixtures ────────────────────────────────────────────────────────────────

// Spawn `extra` extra ai-bearing entities into the active world. Each gets
// a synthetic position picked by walking the world's floor cells in
// row-major order — same RNG stream as the rest of the game (no
// non-determinism from this bench).
function withExtraMobs(state: GameState, extra: number): GameState {
  if (extra <= 0) return state;
  const world = activeWorld(state);
  const rng = fromRngState(state.rngState);
  let placed = 0;
  // The donjon spawn is 80×30; walk row-major and place on anything that
  // isn't a wall and isn't currently occupied. The bench needs a stable
  // count, not interesting positions.
  outer: for (let y = 0; y < 30 && placed < extra; y++) {
    for (let x = 0; x < 80 && placed < extra; x++) {
      // Quick "is this a free floor cell" check via position query is
      // overkill — just spawn at every (x, y) and let collisions stand;
      // toSnapshot reads positions, doesn't care about uniqueness.
      spawn(world, {
        position: { x, y },
        actor: { glyph: "x", name: `extra-${placed}` },
        ai: { kind: "wanderer" },
        hp: { current: 1, max: 1 },
      });
      placed += 1;
      if (placed >= extra) break outer;
    }
  }
  return { ...state, rngState: rng.state() };
}

// Drive the game `n` ticks of WAIT so the heap has real churn and the
// wanderer positions drift from spawn. toSnapshot doesn't care about heap
// state, but advancing turns surfaces any cost that scales with `turn` or
// `state.time` (none expected, but it's free to measure).
function advanceTicks(state: GameState, n: number): GameState {
  let s = state;
  for (let i = 0; i < n; i++) s = tick(s, { type: "WAIT" });
  return s;
}

// ─── Scenarios ───────────────────────────────────────────────────────────────

function runAll(): readonly Result[] {
  const rows: Result[] = [];

  // S1 — fresh newGame. Donjon 80×30, 2 wanderers, turn 0.
  rows.push(bench("S1 newGame (80×30, 2 mobs)", 50_000, newGame(42, "rim")));

  // S2 — newGame + 50 WAITs. Same world, wanderers drifted, scheduler
  // has had time to churn through ~150 events.
  rows.push(
    bench(
      "S2 midgame (80×30, 2 mobs, turn=50)",
      50_000,
      advanceTicks(newGame(42, "rim"), 50),
    ),
  );

  // S3 — donjon stressed with extra mobs. Tests the mobs-loop scaling.
  rows.push(
    bench(
      "S3 donjon-stress (80×30, 100 mobs)",
      30_000,
      withExtraMobs(newGame(42, "rim"), 98),
    ),
  );

  // S4 — donjon stressed harder. Edge of what the project would ever see.
  rows.push(
    bench(
      "S4 donjon-mega (80×30, 1000 mobs)",
      10_000,
      withExtraMobs(newGame(42, "rim"), 998),
    ),
  );

  return rows;
}

// ─── Entry ────────────────────────────────────────────────────────────────────

if (import.meta.main) {
  console.log("\nSnapshot bench — discovery (full toSnapshot, no delta)\n");
  const results = runAll();
  console.log(formatTable(results));
  console.log();
  console.log(
    "Verdict (see header docstring): DEFER the delta-snapshot pass. At\n" +
      "~21 µs / 6.4 KB per accepted action with a turn-based 1-2-actions/sec\n" +
      "rate, the absolute floor is too low to justify the work. Re-evaluate\n" +
      "when grid > 200×100, multi-player ships, or realtime replaces turns.",
  );
  console.log();
}

export type { Result };
export { runAll };
