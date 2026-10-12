use alloc::vec::Vec;
use core::fmt;
use core::num::NonZeroU32;

use korr_ecs::{Component, EntityId, FloorId, Handle, Own, Store};
use korr_grid::{CellColumn, Dir, Grid, Pos, StepError};
use korr_random::{DrawIndex, ModuleKey, Phase, Seed, Stream, Subject};

use crate::build::Ask;
use crate::config::SIGHT;
use crate::life::{Cause, Harm};
use crate::ruleset::{ModuleEntry, Ruleset};
use crate::time::Tick;

/// The ruleset, and how a command reaches its server: built once per floor
/// and round, so a turn copies one pointer rather than both closures.
pub(crate) struct Routes<'a> {
    pub(crate) ruleset: &'a Ruleset,
    /// The `check` of the module at a visit ordinal, on one cell value.
    pub(crate) check: &'a dyn Fn(u16, u8) -> Option<u8>,
    /// The `apply` of the module at a visit ordinal, on one cell value.
    pub(crate) apply: &'a dyn Fn(u16, u8) -> u8,
}

/// The column a command's server binds; the build ensures it binds one.
fn served(modules: &[ModuleEntry], module: u16) -> usize {
    let column = modules[usize::from(module)]
        .column
        .expect("a module that serves a command binds a cell column");
    usize::from(column)
}

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

pub struct PrepCtx<'a> {
    pub(crate) grid: &'a Grid,
    pub(crate) store: &'a Store,
    pub(crate) actor: Handle,
    pub(crate) id: EntityId,
    pub(crate) floor: FloorId,
    pub(crate) draws: Draws,
    pub(crate) now: Tick,
    pub(crate) columns: &'a [CellColumn],
    pub(crate) routes: &'a Routes<'a>,
}

impl fmt::Debug for PrepCtx<'_> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("PrepCtx")
            .field("actor", &self.id)
            .field("floor", &self.floor)
            .field("now", &self.now)
            .finish_non_exhaustive()
    }
}

impl PrepCtx<'_> {
    #[must_use]
    pub fn actor(&self) -> EntityId {
        self.id
    }

    /// # Panics
    /// When the actor is not placed: a due actor always is.
    #[must_use]
    pub fn pos(&self) -> Pos {
        self.grid.pos(self.actor).expect("a due actor is placed")
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
    // With a second caller LTO calls it out of line from wander's prepare:
    // +7% per round on the wander benches.
    #[inline]
    pub fn check_step(&self, dir: Dir) -> Result<Pos, StepError> {
        self.grid.check_step(self.actor, dir)
    }

    /// Where `id` stands on this floor, when it is alive and within `SIGHT`.
    #[must_use]
    pub fn locate(&self, id: EntityId) -> Option<Pos> {
        let at = self.grid.pos(self.store.handle_of(id)?)?;
        let pos = self.pos();
        let distance = at.x.abs_diff(pos.x).max(at.y.abs_diff(pos.y));
        (distance <= SIGHT).then_some(at)
    }

    #[must_use]
    pub fn below(&self, draw: impl Into<DrawIndex>, bound: NonZeroU32) -> u32 {
        self.draws.below(draw, bound)
    }

    /// The server's reply to `C` at `at`; `None` when it refuses, or `at` is
    /// off the floor.
    #[must_use]
    pub fn check<C>(&self, ask: Ask<C>, at: Pos) -> Option<u8> {
        let at = self.grid.shape().idx(at)?;
        let value = self.columns[served(&self.routes.ruleset.modules, ask.module)].get(at);
        (self.routes.check)(ask.module, value)
    }
}

pub struct CommitCtx<'a> {
    pub(crate) grid: &'a mut Grid,
    pub(crate) actor: Handle,
    pub(crate) id: EntityId,
    pub(crate) departures: &'a mut Vec<Departure>,
    pub(crate) store: &'a mut Store,
    pub(crate) columns: &'a mut [CellColumn],
    pub(crate) routes: &'a Routes<'a>,
    pub(crate) harms: &'a mut Vec<Harm>,
}

impl fmt::Debug for CommitCtx<'_> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("CommitCtx")
            .field("actor", &self.actor)
            .finish_non_exhaustive()
    }
}

impl CommitCtx<'_> {
    /// The actor's own row of `key`.
    ///
    /// # Panics
    /// When `key` comes from another schema.
    pub fn get_mut<T: Component>(&mut self, key: &Own<T>) -> Option<&mut T> {
        self.store.get_mut(key, self.actor)
    }

    /// Applies `C` at `at` through its server.
    ///
    /// # Panics
    /// When `at` is off the floor: its prepare must have checked it.
    pub fn order<C>(&mut self, ask: Ask<C>, at: Pos) {
        let at = self
            .grid
            .shape()
            .idx(at)
            .expect("commit of an order its prepare did not check");
        let column = &mut self.columns[served(&self.routes.ruleset.modules, ask.module)];
        column.set(at, (self.routes.apply)(ask.module, column.get(at)));
    }

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

    /// Harms `target` by `amount`, as the actor's doing, once its turn ends.
    pub fn harm(&mut self, target: EntityId, amount: u16) {
        if amount > 0 {
            self.harms.push((target, Cause::Entity(self.id), amount));
        }
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
