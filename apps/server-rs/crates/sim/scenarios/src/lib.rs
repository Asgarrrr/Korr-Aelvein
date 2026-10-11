//! Fixtures for the engine scenario tests.
#![no_std]
#![deny(clippy::float_arithmetic)]

extern crate alloc;

mod leave;
mod scripted;
mod shy;

use korr_core::{
    host::{Floor, Game, Mechanics, Pos, Ruleset, Runner, Seed, Sequential, World},
    mechanic::{
        Action, Band, CommitCtx, Cost, Dir, Module, PrepCtx, Prepared, Proposals, Senses, Target,
    },
};
use korr_ecs::{FloorId, SchemaBuilder};
use korr_grid::Shape;

pub use leave::Leave;
pub use scripted::{Act, Answer, Fake, Scripted};
pub use shy::{Shy, random_step};

/// Declares `$module`, a module named `$name` with no action.
#[macro_export]
macro_rules! actionless {
    ($module:ident, $name:literal $(, CELL_COLUMN = $column:literal)?) => {
        struct $module;

        impl ::korr_core::mechanic::Module for $module {
            const NAME: &'static str = $name;
            $(const CELL_COLUMN: bool = $column;)?
            type Action = ::core::convert::Infallible;
            type Plan = ::core::convert::Infallible;

            fn propose(
                &self,
                _: &::korr_core::mechanic::Senses<'_>,
                _: &mut ::korr_core::mechanic::Proposals<'_, ::core::convert::Infallible>,
            ) {
            }

            fn prepare(
                &self,
                action: ::core::convert::Infallible,
                _: ::korr_core::mechanic::Target,
                _: &::korr_core::mechanic::PrepCtx<'_>,
            ) -> ::korr_core::mechanic::Prepared<::core::convert::Infallible, ::core::convert::Infallible>
            {
                match action {}
            }

            fn commit(
                &self,
                plan: ::core::convert::Infallible,
                _: &mut ::korr_core::mechanic::CommitCtx<'_>,
            ) {
                match plan {}
            }
        }
    };
}

/// # Panics
/// When a side is outside the bounds of `Shape::new`.
#[must_use]
pub fn floor(ruleset: &Ruleset, id: FloorId, width: u16, height: u16) -> Floor {
    let shape = Shape::new(width, height).expect("scenario shapes fit the bounds");
    Floor::new(ruleset, id, shape)
}

/// A copy of `floor` through its own save.
///
/// # Panics
/// When `floor` does not load from its own save.
#[must_use]
pub fn reload(ruleset: &Ruleset, floor: &Floor) -> Floor {
    Floor::load(ruleset, &floor.save(ruleset)).expect("own save loads")
}

/// # Panics
/// When two modules share a name, two actions share an `ActionKey`, or
/// an action requires a component the schema does not register.
#[must_use]
pub fn game<M: Mechanics>(mechanics: M, seed: Seed) -> Game<M> {
    Game::new(SchemaBuilder::default(), mechanics, seed)
}

/// Every actor off floor 0 departs for its centre.
pub const TO_GROUND: Leave = Leave {
    to: FloorId(0),
    at: Pos { x: 2, y: 2 },
};

/// Six 5x5 floors, ids 0 to 5, three actors each at (1..=3, 1). Under
/// `TO_GROUND` the fifteen travellers outnumber floor 0's six free interior
/// cells, so some wait in its inbox.
#[must_use]
pub fn tower(ruleset: &Ruleset) -> World {
    World::new(
        (0..6)
            .map(|id| {
                let mut f = floor(ruleset, FloorId(id), 5, 5);
                for x in 1..=3 {
                    f.spawn_actor(ruleset, Pos { x, y: 1 });
                }
                f
            })
            .collect(),
    )
}

/// # Panics
/// When an actor departs to a floor outside `world`.
pub fn run_on<M: Mechanics + Sync>(
    game: &Game<M>,
    world: &mut World,
    rounds: u64,
    runner: &impl Runner,
) {
    for _ in 0..rounds {
        game.run_round_on(world, runner);
    }
}

/// # Panics
/// When an actor departs to a floor outside `world`.
pub fn run<M: Mechanics + Sync>(game: &Game<M>, world: &mut World, rounds: u64) {
    run_on(game, world, rounds, &Sequential);
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
