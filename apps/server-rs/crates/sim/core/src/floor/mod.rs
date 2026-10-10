mod schedule;
mod turn;

use korr_ecs::{FloorId, Handle, Schema, Store};
use korr_grid::{Grid, Interior, Layer, Material, Pos, Shape};

use crate::decision::Candidates;
use crate::floor::schedule::Schedule;
use crate::time::Tick;

#[derive(Debug)]
pub struct Floor {
    store: Store,
    grid: Grid,
    schedule: Schedule,
    round: u64,
    /// Scratch of one turn, cleared before every proposal.
    candidates: Candidates,
}

impl Floor {
    #[must_use]
    pub fn new(schema: &Schema, id: FloorId, shape: Shape) -> Self {
        Self {
            store: Store::new(schema, id),
            grid: Grid::new(shape),
            schedule: Schedule::default(),
            round: 0,
            candidates: Candidates::default(),
        }
    }

    /// # Panics
    /// When `at` is not an interior cell of this floor.
    pub fn set_material(&mut self, at: Pos, m: Material) {
        let at = self.interior(at);
        self.grid.set_material(at, m);
    }

    /// The actor first acts this round.
    ///
    /// # Panics
    /// When `at` is not an interior cell of this floor, or cannot take an actor.
    pub fn spawn_actor(&mut self, at: Pos) -> Handle {
        let at = self.interior(at);
        assert!(
            self.grid.can_place(at, Layer::Actor),
            "no room for an actor at this cell"
        );
        let h = self.store.spawn();
        self.grid.link_actor(&self.store, h, at);
        let id = self.store.id(h).expect("a spawned handle is alive");
        self.schedule.push(Tick::start_of(self.round), id, h);
        h
    }

    #[must_use]
    pub fn pos(&self, h: Handle) -> Option<Pos> {
        self.grid.pos(h)
    }

    #[must_use]
    pub fn id(&self) -> FloorId {
        self.store.floor()
    }

    #[must_use]
    pub fn round(&self) -> u64 {
        self.round
    }

    /// Phase 4.
    pub(crate) fn end_round(&mut self) {
        self.round += 1;
    }

    fn interior(&self, at: Pos) -> Interior {
        self.grid.shape().idx(at).expect("cell off the floor")
    }
}
