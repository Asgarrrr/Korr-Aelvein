//! Fixtures for the engine scenario tests.
#![no_std]
#![deny(clippy::float_arithmetic)]

extern crate alloc;

mod leave;
mod scripted;
mod shy;

use alloc::vec::Vec;

use korr_core::{
    ActionDesc, Band, Candidate, Candidates, CommitCtx, Cost, Dir, Floor, Game, Mechanics, PrepCtx,
    Prepared, Ruleset, Seed, Senses, Target, World,
};
use korr_ecs::{FloorId, SchemaBuilder};
use korr_grid::Shape;

pub use leave::{LEAVE, Leave};
pub use scripted::{Act, Answer, Scripted};
pub use shy::{STARTLE, Shy};

/// # Panics
/// When a side is outside the bounds of `Shape::new`.
#[must_use]
pub fn floor(ruleset: &Ruleset, id: u16, width: u16, height: u16) -> Floor {
    let shape = Shape::new(width, height).expect("scenario shapes fit the bounds");
    Floor::new(ruleset, FloorId(id), shape)
}

/// # Panics
/// When two actions share an `ActionKey`.
#[must_use]
pub fn game<M: Mechanics>(mechanics: M, seed: Seed) -> Game<M> {
    Game::new(SchemaBuilder::default(), mechanics, seed)
}

/// # Panics
/// When an actor departs to a floor outside `world`.
pub fn run<M: Mechanics>(game: &Game<M>, world: &mut World, rounds: u64) {
    for _ in 0..rounds {
        game.run_round(world);
    }
}

static STEP: ActionDesc = ActionDesc::new("pace", "step");

/// Every actor steps east each turn: 30 ticks for an even id, 100 for an odd one.
#[derive(Debug)]
pub struct Pace;

impl Mechanics for Pace {
    fn actions(&self, out: &mut Vec<&'static ActionDesc>) {
        out.push(&STEP);
    }

    fn perceives(&self) -> bool {
        false
    }

    fn propose(&self, _: &Senses<'_>, out: &mut Candidates) {
        out.push(Candidate {
            action: &STEP,
            band: Band::Routine,
            weight: 0,
            target: Target::None,
        });
    }

    fn prepare(&self, _: &'static ActionDesc, _: Target, ctx: &PrepCtx<'_>) -> Prepared {
        match ctx.check_step(Dir::East) {
            Ok(_) if ctx.actor().to_bits() % 2 == 0 => Prepared::Go {
                cost: Cost::new(30),
            },
            Ok(_) => Prepared::Go {
                cost: Cost::new(100),
            },
            Err(_) => Prepared::Blocked,
        }
    }

    fn commit(&self, _: &'static ActionDesc, _: Target, ctx: &mut CommitCtx<'_>) {
        ctx.step(Dir::East);
    }
}
