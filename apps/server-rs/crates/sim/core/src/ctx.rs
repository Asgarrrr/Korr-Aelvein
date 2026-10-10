use core::num::NonZeroU32;

use korr_ecs::{EntityId, Handle};
use korr_grid::{Dir, Grid, Pos, StepError};
use korr_random::{DrawIndex, Phase, Seed, Stream, Subject};

use crate::action::ActionDesc;
use crate::time::Tick;

/// The draws of one actor's action at one tick: equal in prepare and commit.
#[derive(Debug, Clone, Copy)]
pub(crate) struct Draws {
    stream: Stream,
    actor: Subject,
}

impl Draws {
    pub(crate) fn new(seed: Seed, action: &ActionDesc, now: Tick, actor: EntityId) -> Self {
        Self {
            stream: Stream::new(seed, action.module, Phase::Action, now.0),
            actor: Subject::Entity(actor.to_bits()),
        }
    }

    fn below(self, draw: u32, bound: NonZeroU32) -> u32 {
        self.stream.below(self.actor, DrawIndex(draw), bound)
    }
}

#[derive(Debug)]
pub struct PrepCtx<'a> {
    pub(crate) grid: &'a Grid,
    pub(crate) actor: Handle,
    pub(crate) id: EntityId,
    pub(crate) draws: Draws,
}

impl PrepCtx<'_> {
    #[must_use]
    pub fn actor(&self) -> EntityId {
        self.id
    }

    /// # Errors
    /// Why the actor cannot step in `dir`.
    pub fn check_step(&self, dir: Dir) -> Result<Pos, StepError> {
        self.grid.check_step(self.actor, dir)
    }

    #[must_use]
    pub fn below(&self, draw: u32, bound: NonZeroU32) -> u32 {
        self.draws.below(draw, bound)
    }
}

#[derive(Debug)]
pub struct CommitCtx<'a> {
    pub(crate) grid: &'a mut Grid,
    pub(crate) actor: Handle,
    pub(crate) draws: Draws,
}

impl CommitCtx<'_> {
    /// # Panics
    /// When the step is refused: its prepare must have checked it.
    pub fn step(&mut self, dir: Dir) -> Pos {
        self.grid
            .step(self.actor, dir)
            .expect("commit of a step its prepare refused")
    }

    #[must_use]
    pub fn below(&self, draw: u32, bound: NonZeroU32) -> u32 {
        self.draws.below(draw, bound)
    }
}
