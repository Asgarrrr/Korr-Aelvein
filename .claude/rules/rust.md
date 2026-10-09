---
paths: ["crates/**", "Cargo.toml", "rust-toolchain.toml"]
---

# Rust guide

Read with `CLAUDE.md`. Lints are the floor, not the goal: the workspace
lints live in the root `Cargo.toml`, and the engine's determinism bans in
`crates/engine/clippy.toml`. This file holds what a lint cannot check.

## Lints

- Never `#[allow]` a lint to get green. When a lint is wrong for one item,
  use `#[expect(lint, reason = "...")]`: it fails once the code no longer
  triggers it.
- Never weaken `[workspace.lints]` or `clippy.toml`. Propose the change.

## Types

- Ids and indices are newtypes (`struct EntityId(u32)`), never bare
  integers that two meanings share.
- Make invalid states unrepresentable: an enum over a struct of options.
- Static dispatch in hot paths: generics or an enum. `dyn Trait` only at a
  registration seam that runs once.
- `pub(crate)` by default. `pub` only on what another crate imports.

## Ownership

- Never `.clone()` to silence the borrow checker. Split the borrow, pass an
  index, or restructure.
- No `Rc<RefCell<_>>` in the engine. Columns are owned `Vec`s indexed by
  slot.

## Errors

- A broken engine invariant is a bug: panic with a message that names the
  invariant.
- A recoverable failure returns `Result` with a crate-level error enum.
- No `unwrap`. `expect("...")` only where an invariant guarantees the
  value, and the message states that invariant.

## Integers

- Overflow is a decision, never an accident. Use `wrapping_*` where the TS
  engine wraps (`| 0`, `Math.imul`, `>>> 0`). Use `checked_*` or
  `saturating_*` elsewhere. Never rely on debug and release builds
  behaving differently.
- Prefer `From`/`TryFrom` over `as`. Each `as` that remains must be
  lossless or carry an `#[expect]` with its reason.

## Tests

- Scenario tests go in `crates/<crate>/tests/`, the Rust convention for
  integration tests. Unit tests sit in a `#[cfg(test)] mod tests` beside the
  code, only for a contract a scenario cannot pin down.

## Tools

- Use the LSP (rust-analyzer) for definitions, references and
  implementations before grepping.
- Before a crate or API is used for the first time, confirm its current
  version and API on docs.rs. Never write from memory.
