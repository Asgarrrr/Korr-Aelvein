use alloc::vec::Vec;
use core::num::NonZeroU32;

use korr_ecs::{EntityId, FloorId, Handle};
use korr_grid::{Dir, Grid, Pos, StepError};
use korr_random::{DrawIndex, ModuleKey, Phase, Seed, Stream, Subject};

use crate::time::Tick;

/// The draws of one actor's action at one tick: equal in prepare and commit.
#[derive(Debug, Clone, Copy)]
pub(crate) struct Draws {
    stream: Stream,
    actor: Subject,
}

impl Draws {
    pub(crate) fn new(seed: Seed, module: ModuleKey, now: Tick, actor: EntityId) -> Self {
        Self {
            stream: Stream::new(seed, module, Phase::Action, now.0),
            actor: Subject::Entity(actor.to_bits()),
        }
    }

    fn below(self, draw: DrawIndex, bound: NonZeroU32) -> u32 {
        self.stream.below(self.actor, draw, bound)
    }
}

/// Departures are pushed in turn order, so only the last can be this actor's.
pub(crate) fn departed(departures: &[(Handle, FloorId, Pos)], actor: Handle) -> bool {
    departures.last().is_some_and(|d| d.0 == actor)
}

#[derive(Debug)]
pub struct PrepCtx<'a> {
    pub(crate) grid: &'a Grid,
    pub(crate) actor: Handle,
    pub(crate) id: EntityId,
    pub(crate) floor: FloorId,
    pub(crate) draws: Draws,
    pub(crate) now: Tick,
}

impl PrepCtx<'_> {
    #[must_use]
    pub fn actor(&self) -> EntityId {
        self.id
    }

    #[must_use]
    pub fn now(&self) -> Tick {
        self.now
    }

    #[must_use]
    pub fn floor(&self) -> FloorId {
        self.floor
    }

    /// # Errors
    /// Why the actor cannot step in `dir`.
    pub fn check_step(&self, dir: Dir) -> Result<Pos, StepError> {
        self.grid.check_step(self.actor, dir)
    }

    #[must_use]
    pub fn below(&self, draw: impl Into<DrawIndex>, bound: NonZeroU32) -> u32 {
        self.draws.below(draw.into(), bound)
    }
}

#[derive(Debug)]
pub struct CommitCtx<'a> {
    pub(crate) grid: &'a mut Grid,
    pub(crate) actor: Handle,
    pub(crate) draws: Draws,
    pub(crate) departures: &'a mut Vec<(Handle, FloorId, Pos)>,
}

impl CommitCtx<'_> {
    /// # Panics
    /// When the step is refused: its prepare must have checked it.
    pub fn step(&mut self, dir: Dir) -> Pos {
        self.grid
            .step(self.actor, dir)
            .expect("commit of a step its prepare refused")
    }

    /// The actor leaves at the barrier for the free cell nearest `at` on floor `to`.
    ///
    /// # Panics
    /// When the actor already departed this turn.
    pub fn depart(&mut self, to: FloorId, at: Pos) {
        assert!(
            !departed(self.departures, self.actor),
            "one departure per turn"
        );
        self.departures.push((self.actor, to, at));
    }

    #[must_use]
    pub fn below(&self, draw: impl Into<DrawIndex>, bound: NonZeroU32) -> u32 {
        self.draws.below(draw.into(), bound)
    }
}
