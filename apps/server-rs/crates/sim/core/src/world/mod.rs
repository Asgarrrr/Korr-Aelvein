mod barrier;

use alloc::vec::Vec;

use korr_ecs::{EntityId, FloorId, checksum};
use korr_random::Seed;

use crate::error::WorldError;
use crate::floor::Floor;
use crate::module::Mechanics;
use crate::ruleset::Ruleset;
use crate::runner::{Runner, jobs};

#[derive(Debug)]
pub struct World {
    /// Strictly ascending by `FloorId`.
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
    /// [`WorldError::DuplicateFloor`] for the lowest `FloorId` two floors
    /// share: their entity ids and draws would collide.
    /// [`WorldError::Rounds`] when two floors are at different rounds. Then,
    /// for the lowest failing id:
    /// [`WorldError::UnknownOrigin`] when its origin floor is absent, since that
    /// floor could re-mint it; [`WorldError::BeyondCounter`] when its origin
    /// floor has not minted it yet; [`WorldError::DuplicateEntity`] when it is
    /// alive or waiting on two floors.
    pub fn try_new(mut floors: Vec<Floor>) -> Result<Self, WorldError> {
        floors.sort_unstable_by_key(Floor::id);
        if let Some(pair) = floors.windows(2).find(|pair| pair[0].id() == pair[1].id()) {
            return Err(WorldError::DuplicateFloor(pair[0].id()));
        }
        if floors.iter().any(|f| f.round() != floors[0].round()) {
            return Err(WorldError::Rounds);
        }
        let world = Self { floors };
        let mut ids: Vec<EntityId> = world.floors.iter().flat_map(Floor::ids).collect();
        ids.sort_unstable();
        let mut previous = None;
        for &id in &ids {
            let origin = world
                .position(id.origin())
                .map(|i| &world.floors[i])
                .ok_or(WorldError::UnknownOrigin(id))?;
            if id.counter() >= origin.next_counter() {
                return Err(WorldError::BeyondCounter(id));
            }
            if previous == Some(id) {
                return Err(WorldError::DuplicateEntity(id));
            }
            previous = Some(id);
        }
        Ok(world)
    }

    fn position(&self, id: FloorId) -> Option<usize> {
        self.floors.binary_search_by_key(&id, Floor::id).ok()
    }

    /// Every floor runs its environment then its actors through `runner`, then the barrier.
    ///
    /// # Panics
    /// When an actor departs to a floor outside this world.
    pub(crate) fn run_round(
        &mut self,
        seed: Seed,
        ruleset: &Ruleset,
        mechanics: &(impl Mechanics + Sync),
        runner: &impl Runner,
    ) {
        let work = |floor: &mut Floor| {
            floor.run_environment(seed, ruleset, mechanics);
            floor.run_actors(seed, ruleset, mechanics);
        };
        runner.each(jobs(&mut self.floors, &work));
        self.barrier(ruleset);
    }

    /// In ascending `FloorId`.
    #[must_use]
    pub fn floors(&self) -> &[Floor] {
        &self.floors
    }

    /// The checksum of every floor image, concatenated in ascending `FloorId`.
    #[must_use]
    pub(crate) fn hash(&self, ruleset: &Ruleset) -> u64 {
        let images: Vec<u8> = self
            .floors
            .iter()
            .flat_map(|floor| floor.save(ruleset))
            .collect();
        checksum(&images)
    }

    /// # Panics
    /// When no floor of this world has `id`.
    #[must_use]
    pub fn floor(&self, id: FloorId) -> &Floor {
        &self.floors[self.position(id).expect("no floor in this world")]
    }
}
