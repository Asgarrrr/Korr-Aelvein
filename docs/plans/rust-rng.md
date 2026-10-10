# Plan: Rust RNG, the first foundation leaf

Inputs: `docs/plans/rust-structure.md`; the TS reference
`packages/engine/src/core/random/rng.ts`; a `researcher` report with web
evidence; a partial Codex report (usage limit reached before its answer).

## 1. Decisions

- **Crate.** `korr-random` at `crates/sim/random/`, with no dependency.
  `core`, `genome` and `worldgen` all draw, so it is a leaf below them.
- **Layout move.** The workspace moves to the planned tree in the same
  change: `crates/engine` → `crates/sim/engine`, `crates/server` →
  `crates/host/server`, the engine `clippy.toml` → `crates/sim/clippy.toml`.
  `members` lists paths by depth (cargo#11405).
- **Mixer.** Moremur (Evensen), own code, two multiplies. On counter
  inputs it passes PractRand to 2^33 and beyond where Mix13 (SplitMix64's
  finalizer) fails at 2^19 and Murmur3 at 2^17. No `rapidhash`: its
  folded multiply discards an input when the other is zero, and zero is a
  common field value. No Philox: a block cipher costs too much per word.
- **Shape.** A `Stream` hashes the stable prefix once per callback:
  seed, module, phase, time. The seed is hashed alone first: a raw
  `seed ^ module` would give two worlds the same stream. A draw folds kind,
  subject and index into the stream with one more finalizer.
- **Bounded draw.** Multiply-high on 64 bits: `(x * bound) >> 64` in u128,
  `bound: NonZeroU32`. Bias is below 2^-32 per outcome, so no rejection
  and no extra draw.
- **Module key.** `const fn` FNV-1a-64 of the module name, then Moremur.
  The registry will panic on two equal keys.
- **Types.** `Phase` is a `#[repr(u8)]` enum. `Subject` is an enum,
  `Entity(u32)` or `Cell(u32)`; its value must fit 31 bits so the kind
  and the index pack into one word, and a larger value panics. `Seed`,
  `ModuleKey`, `DrawIndex` are newtypes. Time stays a raw integer here;
  `core` wraps it in its own type.

## 2. API

```rust
pub enum Phase { Propose, Action, Tick, Spawn, Core }
pub enum Subject { Entity(u32), Cell(u32) }
pub struct Seed(pub u64);
pub struct ModuleKey(u64);
pub struct DrawIndex(pub u32);
pub struct Stream(u64);

impl ModuleKey { pub const fn of(name: &str) -> Self; }
impl Stream {
    pub fn new(seed: Seed, module: ModuleKey, phase: Phase, time: u64) -> Self;
    pub fn draw(self, subject: Subject, n: DrawIndex) -> u64;
    pub fn below(self, subject: Subject, n: DrawIndex, bound: NonZeroU32) -> u32;
}
```

## 3. Success criteria, written before the code

In `crates/sim/random/tests/`, all under 1 s:

- Changing any one field (seed, module, phase, time, kind, subject, n)
  changes the draw; two different (subject, n) pairs never alias.
- Avalanche: over 2^12 sequential keys, flipping any input bit flips the
  output bits at a mean rate of 0.5 ± 0.01, and each output bit at
  0.5 ± 0.05. 2^16 keys would hold each bit to ± 0.01 but breaks the 1 s
  budget in a debug build.
- `below` for bounds 2, 7 and 1000, over 2^18 draws with sequential
  subjects, indices and times: chi-square under `df + 6 * sqrt(2 * df)`.
- Known-answer vectors for `draw` and for `below`: they catch a mistyped
  constant or a changed reduction the statistics miss.
- Mutation check before done: swap Moremur for one xor-shift; the
  avalanche and chi-square tests must fail.

## 4. Out of this step

- The cost of one draw against the turn budget: measured once `core` has
  a turn bench.
- An offline PractRand run per field stream (one field counts, the others
  fixed): in `host/tools/sim-cli`, before the `core` API freezes.
- Two final finalizers (subject, then index) if PractRand shows a
  weakness. Any 64-bit scheme overlaps short stretches of two streams;
  PractRand tells whether ours is visible.
