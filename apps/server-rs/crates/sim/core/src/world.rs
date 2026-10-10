use alloc::vec::Vec;

use korr_ecs::{FloorId, checksum};
use korr_random::Seed;

use crate::floor::Floor;
use crate::mechanics::Mechanics;
use crate::ruleset::Ruleset;

#[derive(Debug)]
pub struct World {
    seed: Seed,
    floors: Vec<Floor>,
}

impl World {
    /// # Panics
    /// When two floors share a `FloorId`: their entity ids and draws would
    /// collide. When two floors are at different rounds.
    #[must_use]
    pub fn new(seed: Seed, floors: Vec<Floor>) -> Self {
        for (i, a) in floors.iter().enumerate() {
            assert!(
                floors[i + 1..].iter().all(|b| b.id() != a.id()),
                "duplicate floor id {:?}",
                a.id()
            );
            assert!(a.round() == floors[0].round(), "floors at different rounds");
        }
        Self { seed, floors }
    }

    /// Every floor runs its actors, then the barrier: every floor sends, each
    /// flight joins its destination's inbox, every floor lands, the round ends.
    /// Arrivals act next round and the inbox is ordered, so the floor order
    /// never changes a result.
    ///
    /// # Panics
    /// When an actor departs to a floor outside this world.
    pub fn run_round(&mut self, ruleset: &Ruleset, mechanics: &impl Mechanics) {
        for floor in &mut self.floors {
            floor.run_actors(self.seed, ruleset, mechanics);
        }
        let mut flights = Vec::new();
        for floor in &mut self.floors {
            flights.extend(floor.send());
        }
        for (to, flight) in flights {
            self.floors
                .iter_mut()
                .find(|floor| floor.id() == to)
                .expect("departure to a floor outside this world")
                .inbox
                .insert(flight);
        }
        for floor in &mut self.floors {
            floor.land(ruleset);
        }
        for floor in &mut self.floors {
            floor.end_round();
        }
    }

    /// In the order `new` received them.
    #[must_use]
    pub fn floors(&self) -> &[Floor] {
        &self.floors
    }

    /// The checksum of every floor image, concatenated in ascending `FloorId`.
    #[must_use]
    pub fn hash(&self, ruleset: &Ruleset) -> u64 {
        let mut floors: Vec<&Floor> = self.floors.iter().collect();
        floors.sort_unstable_by_key(|floor| floor.id());
        let images: Vec<u8> = floors
            .into_iter()
            .flat_map(|floor| floor.save(ruleset))
            .collect();
        checksum(&images)
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
