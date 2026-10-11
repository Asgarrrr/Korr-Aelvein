use alloc::vec::Vec;
use core::num::NonZeroU32;

use korr_ecs::{EntityId, FloorId, Handle};
use korr_grid::{Dir, Grid, Pos, StepError};
use korr_random::{DrawIndex, ModuleKey, Phase, Seed, Stream, Subject};

use crate::time::Tick;

/// The draws of one subject at one time: an actor's action, or a cell's tick.
#[derive(Debug, Clone, Copy)]
pub struct Draws {
    stream: Stream,
    subject: Subject,
}

impl Draws {
    pub(crate) fn new(seed: Seed, module: ModuleKey, now: Tick, actor: EntityId) -> Self {
        Self {
            stream: Stream::new(seed, module, Phase::Action, now.0),
            subject: Subject::Entity(actor.to_bits()),
        }
    }

    /// `stream` is the module's tick stream of one round.
    pub(crate) fn cell(stream: Stream, floor: FloorId, at: Pos) -> Self {
        Self {
            stream,
            subject: cell_subject(floor, at),
        }
    }

    #[must_use]
    pub fn below(self, draw: impl Into<DrawIndex>, bound: NonZeroU32) -> u32 {
        self.stream.below(self.subject, draw.into(), bound)
    }
}

/// The floor is part of the subject: the same cell of two floors draws differently.
fn cell_subject(floor: FloorId, at: Pos) -> Subject {
    let (x, y) = (at.x.cast_unsigned(), at.y.cast_unsigned());
    Subject::Cell((u64::from(floor.0) << 32) | (u64::from(y) << 16) | u64::from(x))
}

#[derive(Debug)]
pub(crate) struct Departure {
    pub(crate) actor: Handle,
    pub(crate) to: FloorId,
    pub(crate) at: Pos,
}

/// Departures are pushed in turn order, so only the last can be this actor's.
pub(crate) fn departed(departures: &[Departure], actor: Handle) -> bool {
    departures.last().is_some_and(|d| d.actor == actor)
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
        self.draws.below(draw, bound)
    }
}

#[derive(Debug)]
pub struct CommitCtx<'a> {
    pub(crate) grid: &'a mut Grid,
    pub(crate) actor: Handle,
    pub(crate) departures: &'a mut Vec<Departure>,
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
        self.departures.push(Departure {
            actor: self.actor,
            to,
            at,
        });
    }
}

#[cfg(test)]
mod tests {
    use alloc::collections::BTreeSet;

    use korr_ecs::FloorId;
    use korr_grid::Pos;
    use korr_random::Subject;

    use super::cell_subject;

    #[test]
    fn cell_subjects_never_alias() {
        let floors = [0, 1, 2, u16::MAX].map(FloorId);
        let coords = [1, 2, 255, 256, 257, i16::MAX - 1];
        let mut seen = BTreeSet::new();
        for floor in floors {
            for y in coords {
                for x in coords {
                    let at = Pos { x, y };
                    let Subject::Cell(bits) = cell_subject(floor, at) else {
                        panic!("a cell subject is a cell");
                    };
                    assert!(bits < 1 << 63, "{floor:?} {at:?}");
                    assert!(seen.insert(bits), "{floor:?} {at:?} aliases");
                }
            }
        }
    }
}
