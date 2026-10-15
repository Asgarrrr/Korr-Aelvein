//! Fixtures for the engine scenario tests.
#![no_std]
#![deny(clippy::float_arithmetic)]

extern crate alloc;

mod bleed;
mod leave;
mod ring;
mod scripted;
mod shy;

use korr_core::{
    host::{Floor, Game, Mechanics, Pos, Recipe, Ruleset, Runner, Seed, Sequential, World},
    mechanic::{
        Action, Band, CommitCtx, Cost, Dir, Module, PrepCtx, Prepared, Proposals, ReadCells,
        Senses, Target,
    },
};
use korr_ecs::{EntityId, FloorId, Handle};
use korr_engine::{Modules, Registry};
use korr_grid::Shape;
use korr_hunger::{Diet, Hunger, Satiety};

pub use bleed::{Bleeds, Clot, Wound};
#[doc(hidden)]
pub use korr_core as __core;
pub use leave::Leave;
pub use ring::Ring;
pub use scripted::{Act, Answer, Fake, Scripted};
pub use shy::{Shy, random_step};

/// Declares `$module`, a module named `$name` with no action. With `cells`,
/// its `build` binds a cell column named `$name.cells`, for `keyed`.
#[macro_export]
macro_rules! actionless {
    ($module:ident, $name:literal, cells) => {
        $crate::actionless!($module, $name);

        impl $module {
            fn build(b: &mut $crate::__core::mechanic::Builder<'_>) -> Self {
                b.cells("cells");
                Self
            }
        }
    };
    ($module:ident, $name:literal) => {
        struct $module;

        impl $crate::__core::mechanic::Module for $module {
            const NAME: &'static str = $name;
            type Action = ::core::convert::Infallible;
            type Plan = ::core::convert::Infallible;

            fn propose(
                &self,
                _: &$crate::__core::mechanic::Senses<'_>,
                _: &mut $crate::__core::mechanic::Proposals<'_, ::core::convert::Infallible>,
            ) {
            }

            fn prepare(
                &self,
                action: ::core::convert::Infallible,
                _: $crate::__core::mechanic::Target,
                _: &$crate::__core::mechanic::PrepCtx<'_>,
            ) -> $crate::__core::mechanic::Prepared<
                ::core::convert::Infallible,
                ::core::convert::Infallible,
            > {
                match action {}
            }

            fn commit(
                &self,
                plan: ::core::convert::Infallible,
                _: &mut $crate::__core::mechanic::CommitCtx<'_>,
            ) {
                match plan {}
            }
        }
    };
}

pub const GROUND: FloorId = FloorId(0);

/// Spawn order is id order.
#[must_use]
pub fn nth(floor: FloorId, n: u64) -> EntityId {
    EntityId::new(floor, n)
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
/// the recipe breaks a contract rule.
#[must_use]
pub fn game<R: Recipe>(recipe: R, seed: Seed) -> Game<R::Mechanics> {
    Game::new(recipe, seed)
}

#[must_use]
pub fn flora_only(seed: Seed) -> Game<Modules> {
    game(
        Registry {
            wander: false,
            hunger: false,
            ..Registry::default()
        },
        seed,
    )
}

/// # Panics
/// When the registry does not run hunger.
#[must_use]
pub fn hunger(modules: &Modules) -> &Hunger {
    modules.hunger.as_ref().expect("the registry runs hunger")
}

/// # Panics
/// When the registry does not run flora.
#[must_use]
pub fn plants(modules: &Modules) -> ReadCells {
    modules
        .flora
        .as_ref()
        .expect("the registry runs flora")
        .plants()
}

/// Gives `h` a stomach at `satiety` that takes `diet`.
pub fn stomach(f: &mut Floor, hunger: &Hunger, h: Handle, satiety: u16, diet: Diet) {
    f.init(hunger.satiety(), h, Satiety(satiety));
    f.init(hunger.diet(), h, diet);
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

/// `tower` after three rounds of `TO_GROUND` under `Seed(5)`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Grounded {
    pub hash: u64,
    /// Travellers waiting in floor 0's inbox.
    pub waiting: usize,
}

#[must_use]
pub fn grounded(runner: &impl Runner) -> Grounded {
    let game = game(TO_GROUND, Seed(5));
    let mut world = tower(game.ruleset());
    run_on(&game, &mut world, 3, runner);
    Grounded {
        hash: game.hash(&world),
        waiting: world.floor(FloorId(0)).inbox_len(),
    }
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
