//! The core of one world: floors, turns and the seam mechanics plug into.
#![no_std]
#![deny(clippy::float_arithmetic)]

extern crate alloc;

mod build;
mod config;
mod ctx;
mod decision;
mod error;
mod floor;
mod game;
mod life;
mod module;
mod rows;
mod ruleset;
mod runner;
mod save;
mod senses;
mod time;
mod world;

/// What a mechanic may name: the module seam and the values it trades in.
pub mod mechanic {
    pub use crate::build::{
        Ask, Builder, CellContract, Contract, Provided, ReadCells, Request, Served, provides,
        provides_cells, serves,
    };
    pub use crate::ctx::{Checked, CommitCtx, Draws, PrepCtx};
    pub use crate::decision::Band;
    pub use crate::module::{Action, Module, Prepared, Proposals, Target};
    pub use crate::rows::Rows;
    pub use crate::senses::{Seen, SeenRemains, Senses};
    pub use crate::time::{Cost, Tick};
    pub use korr_ecs::{AnyRead, Component, EntityId, ImageError, Own, Read, Reader, Writer};
    pub use korr_grid::{Dir, Pos, Stencil, StepError};
    pub use korr_random::DrawIndex;
}

/// What runs a world: the game, its floors, their saves and the registry seam.
pub mod host {
    pub use crate::build::{Assembly, Both, Declarations, Keyed, Recipe, Then, keyed};
    pub use crate::config::{EVENTS_PER_ROUND, ROT_PER_ROUND, SIGHT, TICKS_PER_ROUND};
    pub use crate::error::{LoadError, WorldError};
    pub use crate::floor::{FlightImage, Floor, Recording, Sections};
    pub use crate::game::Game;
    pub use crate::life::{Cause, Event, Remains, Vitality};
    pub use crate::module::{ActionKey, Mechanics, Visit};
    pub use crate::ruleset::Ruleset;
    pub use crate::runner::{Job, Runner, Sequential};
    pub use crate::time::Round;
    pub use crate::world::World;
    pub use korr_grid::Pos;
    pub use korr_random::{ModuleKey, Seed};
}
