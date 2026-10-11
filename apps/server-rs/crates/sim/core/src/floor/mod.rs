mod image;
mod inbox;
mod membership;
mod schedule;
mod sections;
mod turn;

use alloc::vec::Vec;
use core::mem;

use korr_ecs::{Component, EntityId, FloorId, Handle, Own, Store};
use korr_grid::{Grid, Interior, Layer, Material, Pos, Shape};

use crate::ctx::Departure;
use crate::decision::Candidates;
use crate::floor::inbox::{Flight, Inbox};
use crate::floor::membership::Joiner;
use crate::floor::schedule::Schedule;
use crate::ruleset::Ruleset;
use crate::senses::Seen;
use crate::time::{Round, Tick};

pub use sections::{FlightImage, Sections};

#[derive(Debug)]
pub struct Floor {
    store: Store,
    grid: Grid,
    schedule: Schedule,
    round: Round,
    /// Actors that departed this round, in departure order; empty at the barrier.
    departures: Vec<Departure>,
    pub(crate) inbox: Inbox,
    /// Scratch of one turn, cleared before every proposal.
    candidates: Candidates,
    /// Scratch of one turn, cleared before every scan.
    seen: Vec<Seen>,
}

impl Floor {
    #[must_use]
    pub fn new(ruleset: &Ruleset, id: FloorId, shape: Shape) -> Self {
        Self {
            store: Store::new(&ruleset.schema, id),
            grid: Grid::new(shape),
            schedule: Schedule::default(),
            round: Round(0),
            departures: Vec::new(),
            inbox: Inbox::default(),
            candidates: Candidates::default(),
            seen: Vec::new(),
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
    pub fn spawn_actor(&mut self, ruleset: &Ruleset, at: Pos) -> Handle {
        let at = self.interior(at);
        assert!(
            self.grid.can_place(at, Layer::Actor),
            "no room for an actor at this cell"
        );
        self.join_actor(ruleset, Joiner::Spawned, at, Tick::start_of(self.round))
    }

    /// # Panics
    /// When `at` is not an interior cell of this floor.
    pub fn spawn_thing(&mut self, at: Pos) -> Handle {
        let at = self.interior(at);
        self.join_thing(at)
    }

    /// For setup and content: a turn never calls it. Returns the value `h` held before.
    ///
    /// # Panics
    /// When `h` is dead, or `key` comes from another schema.
    pub fn insert<T: Component>(&mut self, key: &Own<T>, h: Handle, value: T) -> Option<T> {
        self.store.insert(key, h, value)
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
    pub fn round(&self) -> Round {
        self.round
    }

    pub(crate) fn counter(&self) -> u64 {
        self.store.counter()
    }

    /// Travellers waiting for a free cell on this floor.
    #[must_use]
    pub fn inbox_len(&self) -> usize {
        self.inbox.flights().len()
    }

    /// Every entity alive here, then every traveller waiting in the inbox.
    pub(crate) fn ids(&self) -> impl Iterator<Item = EntityId> + '_ {
        let alive = self.store.handles().filter_map(|h| self.store.id(h));
        alive.chain(self.inbox.flights().iter().map(|f| f.traveller.id()))
    }

    /// At the barrier, this round's departures leave, each with its destination.
    pub(crate) fn send(&mut self) -> Vec<(FloorId, Flight)> {
        let round = self.round;
        mem::take(&mut self.departures)
            .into_iter()
            .map(|Departure { actor, to, at }| {
                let traveller = self.leave(actor);
                (
                    to,
                    Flight {
                        traveller,
                        at,
                        round,
                    },
                )
            })
            .collect()
    }

    pub(crate) fn end_round(&mut self) {
        self.round = self.round.next();
    }

    fn interior(&self, at: Pos) -> Interior {
        self.grid.shape().idx(at).expect("cell off the floor")
    }
}
