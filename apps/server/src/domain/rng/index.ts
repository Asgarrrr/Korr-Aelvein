/**
 * Serialisable PRNG state — four 32-bit signed integers.
 *
 * Lives in `GameState.rngState` so save/load/replay are bit-deterministic.
 * Treat as opaque: only `fromRngState` and `Rng.state()` produce or consume it.
 */
export type RngState = readonly [number, number, number, number];

/**
 * Low-level PRNG primitive — just the algorithm and its serialisable state.
 * High-level operations (`int`, `pick`, `chance`, `split`) are layered on top
 * via free functions so the algorithm can be swapped without touching them.
 */
export type RngCore = {
  /** Random float in [0, 1). Advances state. */
  next(): number;
  /** Snapshot of the internal state. Always returns a fresh tuple. */
  state(): RngState;
};

/**
 * Ergonomic, stateful PRNG bundling `RngCore` with high-level operations.
 *
 * Inside a tick, treat as mutable (call `rng.int(0, 9)` freely).
 * Across ticks, persist via `rng.state()` into `GameState.rngState` and
 * rehydrate next tick with `fromRngState(...)`. This is what makes reducers
 * pure `(state, action) → state` while keeping ergonomic call sites.
 */
export type Rng = RngCore & {
  /**
   * Random integer in [min, max], both bounds inclusive.
   * Throws if min/max are not finite integers, or if max < min.
   */
  int(min: number, max: number): number;
  /** Random element from a non-empty array. Throws if `arr` is empty. */
  pick<T>(arr: readonly T[]): T;
  /**
   * True with probability `p`.
   * Throws if `p` is not in [0, 1] (NaN, Infinity, negative, > 1).
   */
  chance(p: number): boolean;
  /**
   * Spawn a child `Rng` whose sequence is decoupled from this one's future.
   * Advances this `Rng` by 4 calls; the child seeds itself from those outputs.
   * Useful for per-entity / per-chunk RNGs that should not interleave with
   * the main game RNG.
   */
  split(): Rng;
};

// ─── Algorithm ────────────────────────────────────────────────────────────────
//
// sfc32 (Small Fast Counting, 32-bit) — 128-bit state, passes PractRand and
// TestU01 BigCrush. Identical sequence on V8/Bun and any modern browser for a
// given seed. Pure 32-bit arithmetic (no BigInt).
//
// Chosen over Mulberry32 because the latter has a 2^32 period and visits only
// ~2/3 of u32 outputs — a real concern for a roguelike doing thousands of
// procgen calls per level with replay determinism.

/**
 * Build a low-level `RngCore` from a `RngState`. Mutates the four state words
 * in place (held in closure) so each `next()` is allocation-free.
 */
function makeCore(initial: RngState): RngCore {
  let [a, b, c, d] = initial;

  function nextU32(): number {
    const t = (((a + b) | 0) + d) | 0;
    d = (d + 1) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    const rotated = (c << 21) | (c >>> 11);
    c = (rotated + t) | 0;
    return t >>> 0;
  }

  return {
    next() {
      return nextU32() / 0x1_0000_0000;
    },
    state() {
      return [a, b, c, d];
    },
  };
}

/** Expand a single 32-bit seed into four 32-bit state words via SplitMix32. */
function seedToState(seed: number): RngState {
  let s = seed | 0;
  function splitmix32(): number {
    s = (s + 0x9e3779b9) | 0;
    let t = s ^ (s >>> 16);
    t = Math.imul(t, 0x21f0aaad);
    t = t ^ (t >>> 15);
    t = Math.imul(t, 0x735a2d97);
    return (t ^ (t >>> 15)) | 0;
  }
  return [splitmix32(), splitmix32(), splitmix32(), splitmix32()];
}

// Validation in this module is intentional, not a contradiction with the
// global "validate at boundaries only" rule: the PRNG is infrastructure
// consumed by every reducer, so its public surface IS a boundary. A silent
// NaN from `int(NaN, 5)` would corrupt a whole tick.

function nextInt(core: RngCore, min: number, max: number): number {
  if (!Number.isInteger(min))
    throw new Error(`nextInt: min must be a finite integer (got ${min})`);
  if (!Number.isInteger(max))
    throw new Error(`nextInt: max must be a finite integer (got ${max})`);
  if (max < min) throw new Error(`nextInt: max (${max}) < min (${min})`);
  return min + Math.floor(core.next() * (max - min + 1));
}

function nextPick<T>(core: RngCore, arr: readonly T[]): T {
  if (arr.length === 0) throw new Error("nextPick: empty array");
  return nthOrThrow(arr, Math.floor(core.next() * arr.length));
}

function nextChance(core: RngCore, p: number): boolean {
  if (!Number.isFinite(p))
    throw new Error(`nextChance: p must be finite (got ${p})`);
  if (p < 0 || p > 1)
    throw new Error(`nextChance: p must be in [0, 1] (got ${p})`);
  return core.next() < p;
}

// O(1) indexed read. The runtime `undefined` guard — not `as`/`!` — is what
// narrows `arr[idx]` (typed `T | undefined` under noUncheckedIndexedAccess)
// back to `T`; the guard IS the project's sanctioned alternative to an
// assertion. `nextPick` guarantees a non-empty array and an in-bounds idx, so
// the throw is defensive: it can only fire if the element itself is undefined,
// which `pick` treats as bad input — same stance as the empty-array throw.
function nthOrThrow<T>(arr: readonly T[], idx: number): T {
  const item = arr[idx];
  if (item === undefined) {
    throw new Error(
      `nthOrThrow: no value at index ${idx} (length ${arr.length})`,
    );
  }
  return item;
}

// ─── Public factories ──────────────────────────────────────────────────────────

/**
 * Create a fresh `Rng` from a single 32-bit seed.
 *
 * Seed normalisation: NaN, Infinity, 2^32 and floats collapse to a finite i32
 * via `| 0`; negative seeds wrap. So `createRng(NaN)` ≡ `createRng(0)`, etc.
 */
export function createRng(seed: number): Rng {
  return wrap(makeCore(seedToState(seed)));
}

/**
 * Resume an `Rng` from a previously snapshot state.
 *
 * Use in reducers:
 * ```ts
 * const rng = fromRngState(state.rngState);
 * // ... rng.int / rng.pick / rng.chance ...
 * return { ...state, rngState: rng.state() };
 * ```
 */
export function fromRngState(state: RngState): Rng {
  return wrap(makeCore(state));
}

/** Wrap a core with the ergonomic high-level methods. */
function wrap(core: RngCore): Rng {
  return {
    next: core.next,
    state: core.state,
    int(min, max) {
      return nextInt(core, min, max);
    },
    pick(arr) {
      return nextPick(core, arr);
    },
    chance(p) {
      return nextChance(core, p);
    },
    split() {
      // Advance parent by 4 outputs, derive child state from them.
      // Decouples future sequences while staying deterministic.
      const childSeed: RngState = [
        floatToI32(core.next()),
        floatToI32(core.next()),
        floatToI32(core.next()),
        floatToI32(core.next()),
      ];
      return wrap(makeCore(childSeed));
    },
  };
}

function floatToI32(f: number): number {
  return Math.floor(f * 0x1_0000_0000) | 0;
}
