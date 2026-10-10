use alloc::vec::Vec;
use core::mem;

use korr_ecs::{EntityId, Traveller};
use korr_grid::{Layer, Pos};

use crate::floor::Floor;
use crate::ruleset::Ruleset;
use crate::time::Tick;

#[derive(Debug)]
pub(crate) struct Flight {
    pub(crate) traveller: Traveller,
    pub(crate) at: Pos,
    /// The round the traveller left in.
    pub(crate) round: u64,
}

impl Flight {
    pub(crate) fn key(&self) -> (u64, EntityId) {
        (self.round, self.traveller.id())
    }
}

/// Strictly ascending by `(round, EntityId)`, so neither the floor order nor
/// the send order decides who lands first.
#[derive(Debug, Default)]
pub(crate) struct Inbox(Vec<Flight>);

impl Inbox {
    /// # Panics
    /// When a flight with the same key is already waiting.
    pub(crate) fn insert(&mut self, flight: Flight) {
        match self.0.binary_search_by_key(&flight.key(), Flight::key) {
            Ok(_) => panic!("an entity arrives twice"),
            Err(at) => self.0.insert(at, flight),
        }
    }

    pub(crate) fn flights(&self) -> &[Flight] {
        &self.0
    }
}

impl Floor {
    /// At the barrier, each flight in order takes the free cell nearest its `at` and
    /// acts next round. A flight with no free cell waits, in order.
    pub(crate) fn land(&mut self, ruleset: &Ruleset) {
        let next = Tick::start_of(self.round + 1);
        for flight in mem::take(&mut self.inbox.0) {
            let Some(cell) = self.grid.nearest_place(flight.at, Layer::Actor) else {
                self.inbox.0.push(flight);
                continue;
            };
            let id = flight.traveller.id();
            let h = self
                .store
                .attach(flight.traveller)
                .expect("an inbox traveller was checked");
            self.grid.link_actor(&self.store, h, cell);
            self.store.insert(&ruleset.clock, h, next);
            self.schedule.push(next, id, h);
        }
    }
}
