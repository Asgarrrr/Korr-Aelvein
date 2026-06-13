# `domain/rng`

Seeded sfc32 PRNG with serialisable state. Identical sequence across V8/Bun and any modern browser for a given seed — that's what backs the project's "same `(seed, action sequence)` ⇒ byte-identical `GameState` sequence" replay contract.

## API

```ts
import {
  createRng,         // (seed: number) → Rng
  fromRngState,      // (state: RngState) → Rng
  type Rng,
  type RngCore,
  type RngState,
} from "./domain/rng";

const rng = createRng(42);
rng.int(0, 9);              // integer in [0, 9]
rng.pick([10, 20, 30]);     // element from a non-empty array
rng.chance(0.25);           // boolean, true with p
rng.split();                // child Rng decoupled from this one's future
rng.state();                // [a, b, c, d] snapshot of the 4 × i32 state
```

`RngState` is `readonly [number, number, number, number]`. Treat as opaque — only `fromRngState` and `Rng.state()` produce or consume it.

## Lifecycle in reducers

The reducer pattern: hydrate once at the start of a tick, thread through, persist back at the end.

```ts
const rng = fromRngState(state.rngState);
// ... rng.int / rng.pick / rng.chance ...
return { ...state, rngState: rng.state() };
```

`rng.state()` always returns a fresh tuple (no aliasing into the snapshot consumed by the next tick). This is what lets `(state, action) → state` stay value-semantic while the internal state mutates allocation-free.

## Determinism contract

- Same seed ⇒ same `(a, b, c, d)` initial state ⇒ same sequence of `next()` outputs.
- Same `(seed, sequence of `int`/`pick`/`chance`/`split` calls)` ⇒ byte-identical `rngState` returned.
- Algorithm uses pure 32-bit JS arithmetic (`| 0`, `>>>`, `Math.imul`). No BigInt, no platform-dependent FP rounding past a single divide in `next()`.
- `split()` advances the parent by exactly 4 calls; the child reseeds from those four 32-bit outputs.

## Invariants

- **Seed normalisation.** `createRng(NaN)`, `createRng(Infinity)`, `createRng(2 ** 32)`, `createRng(-1)` all collapse to a finite i32 via `| 0`. Same seed input ⇒ same state output regardless of how exotic the caller's number was.
- **Boundary validation on `int` / `chance`.** Non-integer bounds, `max < min`, `p ∉ [0, 1]`, NaN / Infinity — all throw. The PRNG is shared infrastructure consumed by every reducer; a silent NaN from `int(NaN, 5)` would corrupt an entire tick.
- **`pick` throws on bad input, never returns `undefined`.** A zero-length array, or an array whose chosen slot holds `undefined`, is a state-machine bug — `pick` throws rather than silently yielding `undefined`. Pass arrays of defined elements.
- **`split` does NOT clone state.** Parent + child share no future state but parent has been advanced 4 calls. Reproducing the same child requires reproducing the same 4 parent calls.

## Why sfc32

PractRand + TestU01 BigCrush clean. 128-bit state (no period exhaustion in any plausible run). Pure 32-bit JS arithmetic ⇒ no BigInt slowdown, no V8 ↔ browser divergence. Bench median `next() ≈ 4.6 ns/op` on Apple Silicon.

Explicit rejections (revisit at your peril):

| Alternative | Why not |
|---|---|
| **Mulberry32** | 2³² period ⇒ exhaustion realistic for replay runs; visits only ~2/3 of u32 outputs. |
| **PCG / wyrand** | Need 64-bit arithmetic → BigInt → 10–60× slowdown in V8. Not viable for browser-side determinism. |
| **xoshiro128++** | Known low-bit weakness, fails linear-complexity tests (Vigna's own docs). |
| **ChaCha8** | Overkill (cryptographic), ~10× slower than sfc32 in pure JS. |
| **`Math.random()`** | Not seedable, V8 ↔ browser divergence, no replay. |

Full rationale: `~/.claude/projects/-Users-asgarrrr-Documents-Projects-korr-aelvein/memory/project_design_decisions.md`.

## Performance

`bun run bench` from `apps/server/`. Reference numbers on Apple Silicon + Bun 1.3.12:

| Op | ns/op |
|---|---:|
| `rng.next()` | ~4.6 |
| `rng.int(0, 9)` | ~10 |
| `rng.pick([…][10])` | ~5.9 (O(1) — guarded indexed read) |
| `rng.chance(0.5)` | ~6 |

`pick` is O(1): `nthOrThrow` reads `arr[idx]` and narrows the `T | undefined` that `noUncheckedIndexedAccess` gives back to `T` with a runtime `undefined` guard — the guard is the sanctioned no-`as` / no-`!` way to do it, so the index read needs no assertion. (It was previously an O(n) `entries()` scan written under the belief that indexing required an assertion; it does not.) An `undefined` element is treated as bad input and throws, same stance as the empty-array invariant.

## Tests

`bun test src/domain/rng` (46 tests) covers seed normalisation, boundary validation, determinism across many seeds, `split` decoupling, and uniform-distribution sanity over 1 000-call samples. `bun run bench` reports per-op timing.
