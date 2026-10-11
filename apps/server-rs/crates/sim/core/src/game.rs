use korr_ecs::SchemaBuilder;
use korr_random::Seed;

use crate::module::Mechanics;
use crate::ruleset::Ruleset;
use crate::runner::{Runner, Sequential};
use crate::world::World;

/// A ruleset bound to the mechanics it was built from and to one seed.
#[derive(Debug)]
pub struct Game<M> {
    ruleset: Ruleset,
    mechanics: M,
    seed: Seed,
}

impl<M: Mechanics> Game<M> {
    /// # Panics
    /// When two modules share a name, two actions share an `ActionKey`, or
    /// an action requires a component the schema does not register.
    #[must_use]
    pub fn new(schema: SchemaBuilder, mechanics: M, seed: Seed) -> Self {
        let ruleset = Ruleset::new(schema, &mechanics);
        Self {
            ruleset,
            mechanics,
            seed,
        }
    }

    #[must_use]
    pub fn ruleset(&self) -> &Ruleset {
        &self.ruleset
    }

    #[must_use]
    pub fn mechanics(&self) -> &M {
        &self.mechanics
    }

    #[must_use]
    pub fn seed(&self) -> Seed {
        self.seed
    }

    #[must_use]
    pub fn hash(&self, world: &World) -> u64 {
        world.hash(&self.ruleset)
    }
}

impl<M: Mechanics + Sync> Game<M> {
    /// # Panics
    /// When an actor departs to a floor outside `world`.
    pub fn run_round(&self, world: &mut World) {
        self.run_round_on(world, &Sequential);
    }

    /// # Panics
    /// When an actor departs to a floor outside `world`, or when a floor
    /// panics during phase 1.
    pub fn run_round_on(&self, world: &mut World, runner: &impl Runner) {
        world.run_round(self.seed, &self.ruleset, &self.mechanics, runner);
    }
}
