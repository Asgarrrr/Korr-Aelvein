use korr_ecs::{Component, EntityId, Handle, Read, Store};
use korr_grid::{CellColumn, Grid, Pos};

use crate::build::ReadCells;
use crate::config::SIGHT;
use crate::life::Remains;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Seen {
    pub id: EntityId,
    pub pos: Pos,
    /// Valid this turn only: never stored.
    pub(crate) handle: Handle,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SeenRemains {
    pub id: EntityId,
    pub pos: Pos,
    pub mass: u16,
}

/// What an actor perceives this turn: one snapshot, so every proposer reads
/// the same facts whatever the registry order.
#[derive(Debug)]
pub struct Senses<'a> {
    pos: Pos,
    seen: &'a [Seen],
    store: &'a Store,
    actor: Handle,
    grid: &'a Grid,
    remains: Read<Remains>,
    columns: &'a [CellColumn],
}

impl<'a> Senses<'a> {
    pub(crate) fn new(
        pos: Pos,
        seen: &'a [Seen],
        store: &'a Store,
        actor: Handle,
        grid: &'a Grid,
        remains: Read<Remains>,
        columns: &'a [CellColumn],
    ) -> Self {
        Self {
            pos,
            seen,
            store,
            actor,
            grid,
            remains,
            columns,
        }
    }

    /// The actor's own row of `key`.
    ///
    /// # Panics
    /// When `key` comes from another schema.
    #[must_use]
    pub fn get<T: Component>(&self, key: Read<T>) -> Option<&'a T> {
        self.store.get(key, self.actor)
    }

    #[must_use]
    pub fn pos(&self) -> Pos {
        self.pos
    }

    /// `seen`'s row of `key`, read without a lookup.
    ///
    /// # Panics
    /// When `key` comes from another schema.
    #[must_use]
    pub fn get_seen<T: Component>(&self, key: Read<T>, seen: &Seen) -> Option<&'a T> {
        self.store.get(key, seen.handle)
    }

    /// The other actors within sight, in neighbourhood order; empty when the
    /// mechanics do not perceive.
    #[must_use]
    pub fn seen(&self) -> &'a [Seen] {
        self.seen
    }

    /// Every cell of the floor within sight, with its value in `key`'s
    /// column, in neighbourhood order.
    ///
    /// # Panics
    /// When `key` comes from another ruleset.
    pub fn cells(&self, key: ReadCells) -> impl Iterator<Item = (Pos, u8)> + use<'a> {
        let column = &self.columns[key.column.index()];
        let shape = self.grid.shape();
        shape
            .neighbourhood(self.pos, SIGHT)
            .map(move |at| (shape.pos(at.cell()), column.get(at)))
    }

    /// The remains within sight, in neighbourhood order, then id order
    /// within a cell. Walked on each call: only a mechanic that asks pays.
    pub fn remains(&self) -> impl Iterator<Item = SeenRemains> + use<'a> {
        let (grid, store, key) = (self.grid, self.store, self.remains);
        let shape = grid.shape();
        shape.neighbourhood(self.pos, SIGHT).flat_map(move |at| {
            let pos = shape.pos(at.cell());
            grid.things(at.cell()).filter_map(move |h| {
                Some(SeenRemains {
                    mass: store.get(key, h)?.mass,
                    id: store.id(h)?,
                    pos,
                })
            })
        })
    }
}
