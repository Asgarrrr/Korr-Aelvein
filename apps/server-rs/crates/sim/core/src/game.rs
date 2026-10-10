use korr_ecs::SchemaBuilder;
use korr_random::Seed;

use crate::module::Mechanics;
use crate::ruleset::Ruleset;
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
    /// When two modules share a name or two actions share an `ActionKey`.
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

    /// # Panics
    /// When an actor departs to a floor outside `world`.
    pub fn run_round(&self, world: &mut World) {
        world.run_round(self.seed, &self.ruleset, &self.mechanics);
    }

    #[must_use]
    pub fn hash(&self, world: &World) -> u64 {
        world.hash(&self.ruleset)
    }
}
