use alloc::vec::Vec;

use korr_ecs::{EntityId, FloorId, checksum};
use korr_random::Seed;

use crate::error::WorldError;
use crate::floor::Floor;
use crate::module::Mechanics;
use crate::ruleset::Ruleset;

#[derive(Debug)]
pub struct World {
    floors: Vec<Floor>,
}

impl World {
    /// # Panics
    /// When [`World::try_new`] refuses the floors.
    #[must_use]
    pub fn new(floors: Vec<Floor>) -> Self {
        Self::try_new(floors).unwrap_or_else(|e| panic!("{e}"))
    }

    /// Checks what no single floor image can: floors loaded one by one may
    /// come from different histories.
    ///
    /// # Errors
    /// [`WorldError::DuplicateFloor`] when two floors share a `FloorId`: their
    /// entity ids and draws would collide. [`WorldError::Rounds`] when two
    /// floors are at different rounds. Then, for the lowest failing id:
    /// [`WorldError::UnknownOrigin`] when its origin floor is absent, since that
    /// floor could re-mint it; [`WorldError::BeyondCounter`] when its origin
    /// floor has not minted it yet; [`WorldError::DuplicateEntity`] when it is
    /// alive or waiting on two floors.
    pub fn try_new(floors: Vec<Floor>) -> Result<Self, WorldError> {
        for (i, a) in floors.iter().enumerate() {
            if floors[i + 1..].iter().any(|b| b.id() == a.id()) {
                return Err(WorldError::DuplicateFloor(a.id()));
            }
            if a.round() != floors[0].round() {
                return Err(WorldError::Rounds);
            }
        }
        let mut ids: Vec<EntityId> = floors.iter().flat_map(Floor::ids).collect();
        ids.sort_unstable();
        let mut previous = None;
        for &id in &ids {
            let origin = floors
                .iter()
                .find(|floor| floor.id() == id.origin())
                .ok_or(WorldError::UnknownOrigin(id))?;
            if id.counter() >= origin.counter() {
                return Err(WorldError::BeyondCounter(id));
            }
            if previous == Some(id) {
                return Err(WorldError::DuplicateEntity(id));
            }
            previous = Some(id);
        }
        Ok(Self { floors })
    }

    /// Every floor runs its actors, then the barrier: every floor sends, each
    /// flight joins its destination's inbox, every floor lands, the round ends.
    /// Arrivals act next round and the inbox is ordered, so the floor order
    /// never changes a result.
    ///
    /// # Panics
    /// When an actor departs to a floor outside this world.
    pub(crate) fn run_round(&mut self, seed: Seed, ruleset: &Ruleset, mechanics: &impl Mechanics) {
        for floor in &mut self.floors {
            floor.run_actors(seed, ruleset, mechanics);
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
    pub(crate) fn hash(&self, ruleset: &Ruleset) -> u64 {
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
