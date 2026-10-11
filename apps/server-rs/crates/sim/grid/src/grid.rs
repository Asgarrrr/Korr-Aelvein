use korr_ecs::{Handle, Store};

use crate::config::MAX_STEP;
use crate::error::StepError;
use crate::occupancy::{Layer, Occupancy};
use crate::shape::{CellIdx, Dir, Interior, Pos, Shape};
use crate::terrain::{Material, Terrain};

#[derive(Debug)]
pub struct Grid {
    shape: Shape,
    pub(crate) terrain: Terrain,
    occupancy: Occupancy,
}

impl Grid {
    #[must_use]
    pub fn new(shape: Shape) -> Self {
        Self {
            shape,
            terrain: Terrain::new(shape),
            occupancy: Occupancy::new(shape),
        }
    }

    #[must_use]
    #[inline]
    pub fn shape(&self) -> Shape {
        self.shape
    }

    /// Walkability is not checked: worldgen and arrival choose the cell.
    /// Unlink before `Store::despawn` and before `Store::detach`.
    ///
    /// # Panics
    /// When `h` is dead on `store`, its slot is still linked, `at` holds an actor,
    /// or `at` is not an interior cell of this floor.
    pub fn link_actor(&mut self, store: &Store, h: Handle, at: Interior) {
        self.check_interior(at);
        let id = store.id(h).expect("link of a dead handle");
        self.occupancy.link_actor(h, id, at);
    }

    /// Things never block a step and never touch the actor layer.
    /// Unlink before `Store::despawn` and before `Store::detach`.
    ///
    /// # Panics
    /// When `h` is dead on `store`, its slot is still linked, or `at` is not an
    /// interior cell of this floor.
    pub fn link_thing(&mut self, store: &Store, h: Handle, at: Interior) {
        self.check_interior(at);
        let id = store.id(h).expect("link of a dead handle");
        self.occupancy.link_thing(h, id, at);
    }

    /// Call before `Store::despawn` and before `Store::detach`: the slot is recycled after.
    ///
    /// # Panics
    /// When `h` is not linked on this grid, a stale handle on a recycled slot included.
    pub fn unlink(&mut self, h: Handle) {
        self.occupancy.unlink(h);
    }

    /// # Panics
    /// When `at` is not an interior cell of this floor.
    pub fn set_material(&mut self, at: Interior, m: Material) {
        self.check_interior(at);
        self.terrain.set_material(at, m);
    }

    /// # Panics
    /// When `at` is not an interior cell of this floor.
    pub fn set_height(&mut self, at: Interior, h: i8) {
        self.check_interior(at);
        self.terrain.set_height(at, h);
    }

    #[must_use]
    #[inline]
    pub fn actor_at(&self, at: CellIdx) -> Option<Handle> {
        self.occupancy.actor_at(at)
    }

    /// The things linked at `at`, in ascending `EntityId` order.
    pub fn things(&self, at: CellIdx) -> impl Iterator<Item = Handle> + '_ {
        self.occupancy.things(at)
    }

    /// Height is not a placement rule.
    #[must_use]
    pub fn can_place(&self, at: Interior, layer: Layer) -> bool {
        self.terrain.material(at.cell()).walkable()
            && match layer {
                Layer::Actor => !self.occupancy.holds_actor(at.cell()),
                Layer::Thing => true,
            }
    }

    /// The first cell that [`Grid::can_place`] accepts, in neighbourhood order from
    /// `from` clamped to the interior. `None` only when no interior cell fits.
    #[must_use]
    pub fn nearest_place(&self, from: Pos, layer: Layer) -> Option<Interior> {
        let reach = self.shape.width().max(self.shape.height());
        self.shape
            .neighbourhood(self.shape.clamp(from), reach)
            .find(|&at| self.can_place(at, layer))
    }

    /// Moves `h` one cell; a refused step changes nothing.
    ///
    /// # Errors
    /// Checked in this order: [`StepError::Blocked`] when the target is not walkable,
    /// [`StepError::TooSteep`] when |Δh| is above [`MAX_STEP`],
    /// [`StepError::Occupied`] when another actor holds the target.
    ///
    /// # Panics
    /// When `h` is not a linked actor.
    pub fn step(&mut self, h: Handle, dir: Dir) -> Result<Pos, StepError> {
        let from = self
            .occupancy
            .cell_of(h)
            .expect("step of an entity that is not a linked actor");
        let to = self.shape.neighbour(from, dir);
        if !self.terrain.material(to).walkable() {
            return Err(StepError::Blocked);
        }
        if self
            .terrain
            .height(from.cell())
            .abs_diff(self.terrain.height(to))
            > MAX_STEP
        {
            return Err(StepError::TooSteep);
        }
        if self.occupancy.holds_actor(to) {
            return Err(StepError::Occupied);
        }
        let to = Interior::of_walkable(to);
        self.occupancy.move_actor(h, to);
        Ok(self.shape.pos(to.cell()))
    }

    fn check_interior(&self, at: Interior) {
        assert!(self.shape.holds(at), "cell outside this floor's interior");
    }
}
