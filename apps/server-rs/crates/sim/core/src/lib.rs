//! The core of one world: floors, turns and the seam mechanics plug into.
#![no_std]
#![deny(clippy::float_arithmetic)]

extern crate alloc;

mod config;
mod ctx;
mod decision;
mod error;
mod floor;
mod game;
mod module;
mod ruleset;
mod save;
mod senses;
mod time;
mod world;

pub use config::{IDLE, INERTIA, MAX_INSTEAD, SIGHT, TICKS_PER_ROUND};
pub use ctx::{CommitCtx, PrepCtx};
pub use decision::{Band, Intent};
pub use error::{LoadError, WorldError};
pub use floor::{FlightImage, Floor, Sections};
pub use game::Game;
pub use korr_grid::{Dir, Pos, StepError};
pub use korr_random::{DrawIndex, Seed};
pub use module::{Action, ActionKey, Mechanics, Module, Prepared, Proposals, Target, Visit};
pub use ruleset::Ruleset;
pub use senses::{Seen, Senses};
pub use time::{Cost, Tick};
pub use world::World;
