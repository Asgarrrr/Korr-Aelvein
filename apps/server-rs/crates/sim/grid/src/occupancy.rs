use alloc::vec;
use alloc::vec::Vec;
use core::iter;

use korr_ecs::{EntityId, Handle};

use crate::shape::{CellIdx, Interior, PackedCell, Shape};

pub(crate) const EMPTY: u32 = u32::MAX;

/// Which list of its cell a placed entity joins.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Layer {
    Actor,
    Thing,
}

#[derive(Debug)]
struct Link {
    handle: Handle,
    at: PackedCell,
    id: EntityId,
    place: Place,
}

const _: () = assert!(
    size_of::<Option<Link>>() == 32,
    "a 40-byte link slowed actor_at by 26% in the grid bench"
);

impl Link {
    /// The next slot in the cell's thing list.
    fn next(&self) -> u32 {
        match self.place {
            Place::Thing { next, .. } => next,
            Place::Actor => unreachable!("a listed slot is a thing"),
        }
    }
}

#[derive(Debug, Clone, Copy)]
enum Place {
    Actor,
    /// Neighbour slots in the cell's thing list, `EMPTY` at the ends.
    Thing {
        next: u32,
        prev: u32,
    },
}

/// Who stands where. The links are the placement records, the source of
/// position saved in the floor image; the cell indexes derive from them.
#[derive(Debug)]
pub(crate) struct Occupancy {
    shape: Shape,
    /// Per padded cell, the actor's slot or `EMPTY`: one 4-byte load for the blocking test.
    actor: Vec<u32>,
    /// Per padded cell, the first thing's slot or `EMPTY`: the list ascends by `EntityId`.
    head: Vec<u32>,
    /// Indexed by slot: the grid cannot build a `Handle` from a slot.
    links: Vec<Option<Link>>,
}

impl Occupancy {
    pub(crate) fn new(shape: Shape) -> Self {
        Self {
            shape,
            actor: vec![EMPTY; shape.cell_count()],
            head: vec![EMPTY; shape.cell_count()],
            links: Vec::new(),
        }
    }

    pub(crate) fn link_actor(&mut self, h: Handle, id: EntityId, at: Interior) {
        let slot = self.vacant_slot(h);
        assert!(!self.holds_actor(at.cell()), "cell already holds an actor");
        self.links[slot as usize] = Some(Link {
            handle: h,
            at: at.pack(),
            id,
            place: Place::Actor,
        });
        self.actor[at.cell().index()] = slot;
    }

    /// Inserts before the first link with a greater id: ids never repeat, so the order is strict.
    pub(crate) fn link_thing(&mut self, h: Handle, id: EntityId, at: Interior) {
        let slot = self.vacant_slot(h);
        let mut prev = EMPTY;
        let mut next = self.head[at.cell().index()];
        while next != EMPTY {
            if self.link(next).id > id {
                break;
            }
            prev = next;
            next = self.link(next).next();
        }
        self.links[slot as usize] = Some(Link {
            handle: h,
            at: at.pack(),
            id,
            place: Place::Thing { next, prev },
        });
        self.point_forward(at.cell(), prev, slot);
        self.point_back(next, slot);
    }

    /// # Panics
    /// When the slot of `h` is still linked.
    fn vacant_slot(&mut self, h: Handle) -> u32 {
        let slot = h.slot().get();
        let index = slot as usize;
        if self.links.len() <= index {
            self.links.resize_with(index + 1, || None);
        }
        assert!(
            self.links[index].is_none(),
            "slot still linked: unlink before despawn or detach"
        );
        slot
    }

    fn link(&self, slot: u32) -> &Link {
        self.links[slot as usize]
            .as_ref()
            .expect("a listed slot has a link")
    }

    fn thing_mut(&mut self, slot: u32) -> (&mut u32, &mut u32) {
        let link = self.links[slot as usize]
            .as_mut()
            .expect("a listed slot has a link");
        match &mut link.place {
            Place::Thing { next, prev } => (next, prev),
            Place::Actor => unreachable!("a listed slot is a thing"),
        }
    }

    /// Sets the `next` of `prev`, or the cell's head when `prev` is `EMPTY`.
    fn point_forward(&mut self, cell: CellIdx, prev: u32, to: u32) {
        match prev {
            EMPTY => self.head[cell.index()] = to,
            prev => *self.thing_mut(prev).0 = to,
        }
    }

    fn point_back(&mut self, next: u32, to: u32) {
        if next != EMPTY {
            *self.thing_mut(next).1 = to;
        }
    }

    /// # Panics
    /// When `h` is not linked, before any write.
    pub(crate) fn unlink(&mut self, h: Handle) {
        let link = self
            .links
            .get_mut(h.slot().get() as usize)
            .filter(|link| link.as_ref().is_some_and(|link| link.handle == h))
            .and_then(Option::take)
            .expect("entity not linked on this grid");
        let cell = self.shape.unpack(link.at).cell();
        match link.place {
            Place::Actor => self.actor[cell.index()] = EMPTY,
            Place::Thing { next, prev } => {
                self.point_forward(cell, prev, next);
                self.point_back(next, prev);
            }
        }
    }

    /// One placement record per link, in ascending slot.
    pub(crate) fn records(&self) -> impl Iterator<Item = (EntityId, Layer, Interior)> + '_ {
        self.links.iter().flatten().map(|link| {
            let layer = match link.place {
                Place::Actor => Layer::Actor,
                Place::Thing { .. } => Layer::Thing,
            };
            (link.id, layer, self.shape.unpack(link.at))
        })
    }

    #[inline]
    pub(crate) fn holds_actor(&self, at: CellIdx) -> bool {
        self.actor[at.index()] != EMPTY
    }

    #[inline]
    pub(crate) fn actor_at(&self, at: CellIdx) -> Option<Handle> {
        match self.actor[at.index()] {
            EMPTY => None,
            slot => Some(
                self.links[slot as usize]
                    .as_ref()
                    .expect("an occupied cell has a link")
                    .handle,
            ),
        }
    }

    /// `None` when `h` is not a linked actor.
    pub(crate) fn cell_of(&self, h: Handle) -> Option<Interior> {
        self.linked(h)
            .filter(|link| matches!(link.place, Place::Actor))
            .map(|link| self.shape.unpack(link.at))
    }

    /// Any layer. `None` when `h` is not linked.
    pub(crate) fn linked_cell(&self, h: Handle) -> Option<Interior> {
        self.linked(h).map(|link| self.shape.unpack(link.at))
    }

    fn linked(&self, h: Handle) -> Option<&Link> {
        self.links
            .get(h.slot().get() as usize)?
            .as_ref()
            .filter(|link| link.handle == h)
    }

    /// Ascending `EntityId`.
    pub(crate) fn things(&self, at: CellIdx) -> impl Iterator<Item = Handle> + '_ {
        let listed = move |slot: u32| (slot != EMPTY).then(|| self.link(slot));
        iter::successors(listed(self.head[at.index()]), move |link| {
            listed(link.next())
        })
        .map(|link| link.handle)
    }

    /// # Panics
    /// When `h` is not a linked actor.
    pub(crate) fn move_actor(&mut self, h: Handle, to: Interior) {
        let slot = h.slot().get();
        let link = self.links[slot as usize]
            .as_mut()
            .filter(|link| link.handle == h && matches!(link.place, Place::Actor))
            .expect("move of an entity that is not a linked actor");
        self.actor[self.shape.unpack(link.at).cell().index()] = EMPTY;
        self.actor[to.cell().index()] = slot;
        link.at = to.pack();
    }
}
