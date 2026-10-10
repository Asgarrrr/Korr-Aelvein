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
- **Mixer.** NASAM (Evensen), own code, two multiplies plus one
  rotate-xor. Moremur came first and failed PractRand (Gap-16) at 2^40
  bytes on 32 subjects of 2^32 sequential indices each. Its author reports
  NASAM passing RRC-64-42-TF2-0.94 to 1 PB
  (mostlymangling.blogspot.com, 2020-01); Mix13 (SplitMix64's
  finalizer) fails PractRand at 2^19 on counters. No `rapidhash`: its
  folded multiply discards an input when the other is zero, and zero is a
  common field value. No Philox: a block cipher costs too much per word.
- **Shape.** A `Stream` hashes the stable prefix once per callback:
  seed, module, phase, time. The seed is hashed alone first: a raw
  `seed ^ module` would give two worlds the same stream. A draw absorbs
  the subject, then the index, one finalizer each. One fold of
  `prefix ^ (subject, index)` would let two streams whose prefixes differ in
  low bits share draws at shifted indices. The extra finalizer costs about
  one mixer per draw; `core` can cache the subject step when it draws
  several times for one subject.
- **Bounded draw.** Multiply-high on 64 bits: `(x * bound) >> 64` in u128,
  `bound: NonZeroU32`. Bias is below 2^-32 per outcome, so no rejection
  and no extra draw.
- **Module key.** `const fn` FNV-1a-64 of the module name, then NASAM.
  The registry will panic on two equal keys.
- **Phase.** An enum with no `Core` variant: no core draw exists yet. Each
  variant maps to a literal tag, so reordering or inserting one shifts no
  draw. Mechanics never name it: `core` builds one private `Stream` per
  callback context and exposes only the draws.
- **Types.** `Subject` is an enum,
  `Entity(u64)` or `Cell(u64)`; its value must fit 63 bits so the kind
  bit separates entities from cells, and a larger value panics. The id
  layout stays a `core` choice. `Seed`,
  `ModuleKey`, `DrawIndex` are newtypes. Time stays a raw integer here;
  `core` wraps it in its own type.

## 2. API

```rust
pub enum Phase { Propose, Action, Tick, Spawn }
pub enum Subject { Entity(u64), Cell(u64) }
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
- Mutation check before done: swap the mixer for one xor-shift; the
  avalanche and chi-square tests must fail.

## 4. Out of this step

- The cost of one draw against the turn budget: measured once `core` has
  a turn bench.

## 5. PractRand results

`sim-cli rng <field> | RNG_test stdin64 -multithreaded`, PractRand pre0.95,
one field counting, the others fixed. A weakened mixer (one multiply)
fails BCFN at 256 MB, so the pipeline catches a weak mixer.

| Field | Moremur | NASAM |
|---|---|---|
| index | FAIL Gap-16:B at 1 TB (p = 3.5e-14) | pass to 1 TB |
| subject, cell, time, turn | pass to 512 GB | pass to 512 GB |
| seed | pass to 256 GB | pass to 512 GB |

NASAM shows no suspicious result, and no unusual result repeats across
sizes.
