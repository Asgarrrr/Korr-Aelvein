//! Fixtures for the engine scenario tests.
#![no_std]
#![deny(clippy::float_arithmetic)]

extern crate alloc;

mod leave;
mod scripted;
mod shy;

use korr_core::{
    host::{Floor, Game, Mechanics, Ruleset, Seed, World},
    mechanic::{
        Action, Band, CommitCtx, Cost, Dir, Module, PrepCtx, Prepared, Proposals, Senses, Target,
    },
};
use korr_ecs::{FloorId, SchemaBuilder};
use korr_grid::Shape;

pub use leave::Leave;
pub use scripted::{Act, Answer, Fake, Scripted};
pub use shy::{Shy, random_step};

/// # Panics
/// When a side is outside the bounds of `Shape::new`.
#[must_use]
pub fn floor(ruleset: &Ruleset, id: u16, width: u16, height: u16) -> Floor {
    let shape = Shape::new(width, height).expect("scenario shapes fit the bounds");
    Floor::new(ruleset, FloorId(id), shape)
}

/// # Panics
/// When two modules share a name, two actions share an `ActionKey`, or
/// an action requires a component the schema does not register.
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

/// Every actor steps east each turn: 30 ticks for an even id, 100 for an odd one.
#[derive(Debug)]
pub struct Pace;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Step {
    Step,
}

impl Action for Step {
    const ALL: &'static [Self] = &[Self::Step];

    fn name(self) -> &'static str {
        "step"
    }
}

impl Module for Pace {
    const NAME: &'static str = "pace";
    type Action = Step;
    type Plan = ();

    fn propose(&self, _: &Senses<'_>, out: &mut Proposals<'_, Step>) {
        out.push(Step::Step, Band::Routine, 0, Target::None);
    }

    fn prepare(&self, _: Step, _: Target, ctx: &PrepCtx<'_>) -> Prepared<Step, ()> {
        match ctx.check_step(Dir::East) {
            Ok(_) if ctx.actor().to_bits() % 2 == 0 => Prepared::Go {
                cost: Cost::new(30),
                plan: (),
            },
            Ok(_) => Prepared::Go {
                cost: Cost::new(100),
                plan: (),
            },
            Err(_) => Prepared::Blocked,
        }
    }

    fn commit(&self, (): (), ctx: &mut CommitCtx<'_>) {
        ctx.step(Dir::East);
    }
}
