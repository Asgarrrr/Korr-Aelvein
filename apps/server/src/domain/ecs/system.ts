// System ordering is explicit and deterministic by design — no precedence DSL,
// no auto-DAG. The dev keeps the array in the right order. Systems mutate
// the World in place; they return void. Run them by passing the same World
// reference through `runSystems`; the World is mutated as a side effect.

import type { Rng } from "../rng/index";
import type { World } from "./world";

/**
 * Per-tick context handed to every system. `rng` is a live, mutable PRNG for
 * this tick — pull as many draws as needed; persist `rng.state()` into
 * `GameState.rngState` at the end of the tick. `tick` is the current tick
 * number (0-based, before this tick increments it).
 */
export type SystemCtx = {
  readonly rng: Rng;
  readonly tick: number;
};

export type System = (world: World, ctx: SystemCtx) => void;

export function runSystems(
  world: World,
  systems: readonly System[],
  ctx: SystemCtx,
): void {
  for (const system of systems) system(world, ctx);
}
