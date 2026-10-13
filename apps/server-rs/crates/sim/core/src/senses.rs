use korr_ecs::{Component, EntityId, Handle, Read, Store};
use korr_grid::{CellColumn, Grid, Interior, Pos, Shape};

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
    /// column, row by row.
    ///
    /// # Panics
    /// When `key` comes from another ruleset.
    pub fn cells(&self, key: ReadCells) -> impl Iterator<Item = (Pos, u8)> + use<'a> {
        let column = &self.columns[key.column.index()];
        in_sight(self.grid.shape(), self.pos).map(move |(pos, at)| (pos, column.get(at)))
    }

    /// The remains within sight, in no stated order. Few remains are read
    /// from their column, more by walking the cells in sight: on each call,
    /// so only a mechanic that asks pays.
    pub fn remains(&self) -> impl Iterator<Item = SeenRemains> + use<'a> {
        let (grid, store, key, centre) = (self.grid, self.store, self.remains, self.pos);
        let side = 2 * usize::from(SIGHT) + 1;
        let few = store.values(key).len() <= side * side;
        let listed = few.then(|| {
            store.iter(key).filter_map(move |(h, remains)| {
                let pos = grid.pos(h)?;
                let distance = pos.x.abs_diff(centre.x).max(pos.y.abs_diff(centre.y));
                (distance <= SIGHT).then_some(SeenRemains {
                    id: store.id(h)?,
                    pos,
                    mass: remains.mass,
                })
            })
        });
        let walked = (!few).then(|| {
            in_sight(grid.shape(), centre).flat_map(move |(pos, at)| {
                grid.things(at.cell()).filter_map(move |h| {
                    Some(SeenRemains {
                        mass: store.get(key, h)?.mass,
                        id: store.id(h)?,
                        pos,
                    })
                })
            })
        });
        listed
            .into_iter()
            .flatten()
            .chain(walked.into_iter().flatten())
    }
}

/// The interior cells within `SIGHT` of `centre`, row by row: nested ranges
/// fold into plain loops, where the ring order does not.
fn in_sight(shape: Shape, centre: Pos) -> impl Iterator<Item = (Pos, Interior)> {
    let sight = SIGHT.cast_signed();
    let (last_x, last_y) = (
        shape.width().cast_signed() - 2,
        shape.height().cast_signed() - 2,
    );
    let (left, right) = ((centre.x - sight).max(1), (centre.x + sight).min(last_x));
    let (top, bottom) = ((centre.y - sight).max(1), (centre.y + sight).min(last_y));
    (top..=bottom)
        .flat_map(move |y| (left..=right).map(move |x| Pos { x, y }))
        .filter_map(move |pos| Some((pos, shape.idx(pos)?)))
}
