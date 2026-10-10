//! The core of one world: floors, turns and the seam mechanics plug into.
#![no_std]
#![deny(clippy::float_arithmetic)]

extern crate alloc;

mod action;
mod config;
mod ctx;
mod decision;
mod floor;
mod mechanics;
mod time;
mod world;

pub use action::{ActionDesc, Prepared};
pub use config::{IDLE, TICKS_PER_ROUND};
pub use ctx::{CommitCtx, PrepCtx};
pub use decision::Candidates;
pub use floor::Floor;
pub use korr_grid::{Dir, Pos, StepError};
pub use korr_random::Seed;
pub use mechanics::Mechanics;
pub use time::{Cost, Tick};
pub use world::World;
