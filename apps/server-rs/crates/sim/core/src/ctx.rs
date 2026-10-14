use alloc::vec::Vec;
use core::fmt;
use core::num::NonZeroU32;

use korr_ecs::{Component, EntityId, FloorId, Handle, Own, Store};
use korr_grid::{CellColumn, Dir, Grid, Interior, Pos, StepError};
use korr_random::{DrawIndex, ModuleKey, Phase, Seed, Stream, Subject};

use crate::build::{Ask, ColumnName, FOREIGN_ASK};
use crate::config::SIGHT;
use crate::life::{Cause, Harm};
use crate::ruleset::Ruleset;
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

/// Whether `at` lies within `SIGHT` of `actor`: as far as a ctx reaches.
fn within_sight(grid: &Grid, actor: Handle, at: Pos) -> bool {
    at.chebyshev(grid.pos(actor).expect("a due actor is placed")) <= SIGHT
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
    pub(crate) names: &'a [ColumnName],
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
    // Inlined: LTO outlines it from wander's prepare once it has several
    // callers, costing 7% of a round on the wander benches.
    #[inline]
    pub fn check_step(&self, dir: Dir) -> Result<Pos, StepError> {
        self.grid.check_step(self.actor, dir)
    }

    /// Where `id` stands on this floor, when it is alive and within `SIGHT`.
    #[must_use]
    pub fn locate(&self, id: EntityId) -> Option<Pos> {
        let at = self.grid.pos(self.store.handle_of(id)?)?;
        within_sight(self.grid, self.actor, at).then_some(at)
    }

    #[must_use]
    pub fn below(&self, draw: impl Into<DrawIndex>, bound: NonZeroU32) -> u32 {
        self.draws.below(draw, bound)
    }

    /// The server's reply to `C` at `at`, with the token that orders it;
    /// `None` when it refuses, or `at` is off the floor or beyond `SIGHT`.
    ///
    /// # Panics
    /// When `ask` comes from another ruleset: checked in debug builds only;
    /// release reads whatever column holds its index, or panics out of bounds.
    #[must_use]
    pub fn check<C>(&self, ask: Ask<C>, at: Pos) -> Option<(Checked<C>, u8)> {
        debug_assert!(ask.cells.is_in(self.names), "{FOREIGN_ASK}");
        if !within_sight(self.grid, self.actor, at) {
            return None;
        }
        let at = self.grid.shape().idx(at)?;
        let reply = (ask.service.check)(self.columns[ask.cells.column.index()].get(at))?;
        Some((Checked { ask, at }, reply))
    }
}

/// A request `PrepCtx::check` accepted at one cell, and the only way to
/// order it: it lives from a prepare to the commit of the same run.
pub struct Checked<C> {
    ask: Ask<C>,
    at: Interior,
}

impl<C> fmt::Debug for Checked<C> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("Checked")
            .field("ask", &self.ask)
            .field("at", &self.at)
            .finish()
    }
}

pub struct CommitCtx<'a> {
    pub(crate) grid: &'a mut Grid,
    pub(crate) actor: Handle,
    pub(crate) id: EntityId,
    pub(crate) departures: &'a mut Vec<Departure>,
    pub(crate) store: &'a mut Store,
    pub(crate) columns: &'a mut [CellColumn],
    pub(crate) ruleset: &'a Ruleset,
    pub(crate) harms: &'a mut Vec<Harm>,
    pub(crate) emptied: &'a mut Vec<(EntityId, Handle)>,
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

    /// Applies the request its prepare checked, at its cell, through its server.
    ///
    /// # Panics
    /// When `checked` comes from another ruleset, or a floor of another shape.
    #[expect(
        clippy::needless_pass_by_value,
        reason = "an order spends its token, so one check orders once"
    )]
    pub fn order<C>(&mut self, checked: Checked<C>) {
        let Checked { ask, at } = checked;
        assert!(ask.cells.is_in(&self.ruleset.columns), "{FOREIGN_ASK}");
        let column = &mut self.columns[ask.cells.column.index()];
        column.set(at, (ask.service.apply)(column.get(at)));
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
        if amount > 0
            && let Some(h) = self.store.handle_of(target)
        {
            self.harms.push((target, h, Cause::Entity(self.id), amount));
        }
    }

    /// Eats up to `amount` of the mass of the remains named `id`, and returns
    /// what it ate: 0 when `id` names no remains within `SIGHT`. Remains eaten
    /// to nothing leave once the turn ends, so later actors never see them.
    pub fn consume(&mut self, id: EntityId, amount: u16) -> u16 {
        let Some(h) = self.store.handle_of(id) else {
            return 0;
        };
        if !self
            .grid
            .pos(h)
            .is_some_and(|at| within_sight(self.grid, self.actor, at))
        {
            return 0;
        }
        let Some(remains) = self.store.get_mut(&self.ruleset.remains, h) else {
            return 0;
        };
        let eaten = amount.min(remains.mass);
        remains.mass -= eaten;
        if eaten > 0 && remains.mass == 0 {
            self.emptied.push((id, h));
        }
        eaten
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
