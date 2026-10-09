---
paths: ["apps/server-rs/**"]
---

# Rust guide

Read with `CLAUDE.md`. Lints are the floor, not the goal: the workspace
lints live in `apps/server-rs/Cargo.toml`, and the engine's determinism
bans in `crates/engine/clippy.toml`. This file holds what a lint cannot
check. Paths below are relative to `apps/server-rs/`.

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
  version and API with `rust-skills:rust-learner` or `rust-skills:docs`.
  Never write from memory.

## Skills

Load the matching `rust-skills` skill before writing, not after a failure:

| Situation | Skill |
|---|---|
| Borrow, move or lifetime error | `rust-skills:m01-ownership` |
| `&mut` conflict, interior mutability | `rust-skills:m03-mutability` |
| Generics, traits, static against dynamic dispatch | `rust-skills:m04-zero-cost` |
| Newtypes, ids, invalid states, builders | `rust-skills:m05-type-driven` |
| `Result`, error enums, panic or return | `rust-skills:m06-error-handling` |
| Threads, `Send`/`Sync`, async, floor parallelism | `rust-skills:m07-concurrency` |
| A hot path, a benchmark, an allocation | `rust-skills:m10-performance` |
| Adding a crate or a feature flag | `rust-skills:m11-ecosystem` |
| The server: HTTP, WebSocket, axum, shared state | `rust-skills:domain-web` |
| Rename or move a symbol | `rust-skills:rust-refactor-helper` |

Before reporting a Rust change done, run `rust-skills:m15-anti-pattern` on
the diff.
