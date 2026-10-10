use alloc::vec::Vec;

use korr_ecs::FloorId;
use korr_random::Seed;

use crate::floor::Floor;
use crate::mechanics::Mechanics;

#[derive(Debug)]
pub struct World {
    seed: Seed,
    floors: Vec<Floor>,
}

impl World {
    #[must_use]
    pub fn new(seed: Seed, floors: Vec<Floor>) -> Self {
        Self { seed, floors }
    }

    /// Phase 2 on every floor, then the barrier on every floor.
    pub fn run_round(&mut self, mechanics: &impl Mechanics) {
        for floor in &mut self.floors {
            floor.run_actors(self.seed, mechanics);
        }
        for floor in &mut self.floors {
            floor.end_round();
        }
    }

    /// # Panics
    /// When no floor of this world has `id`.
    #[must_use]
    pub fn floor(&self, id: FloorId) -> &Floor {
        self.floors
            .iter()
            .find(|floor| floor.id() == id)
            .expect("no floor in this world")
    }
}
