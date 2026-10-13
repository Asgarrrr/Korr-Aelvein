mod environment;
mod image;
mod inbox;
mod life;
mod membership;
mod schedule;
mod sections;
mod turn;

use alloc::vec::Vec;
use core::mem;

use korr_ecs::{Component, EntityId, FloorId, Handle, Own, Read, Store};
use korr_grid::{CellColumn, Grid, Interior, Layer, Material, Pos, Shape};

use crate::build::ReadCells;
use crate::ctx::Departure;
use crate::decision::Candidates;
use crate::floor::inbox::{Flight, Inbox};
use crate::floor::membership::Joiner;
use crate::floor::schedule::Schedule;
use crate::life::{Event, Harm, Remains};
use crate::ruleset::Ruleset;
use crate::senses::Seen;
use crate::time::{Round, Tick};

pub use sections::{FlightImage, Sections};

#[derive(Debug)]
pub struct Floor {
    store: Store,
    grid: Grid,
    /// One per entry of `Ruleset::columns`, in the same order.
    columns: Vec<CellColumn>,
    /// The next values of the column being ticked; swapped with it, never read between ticks.
    /// `None` when the ruleset has no cell column.
    scratch: Option<CellColumn>,
    /// Fingerprint of the ruleset that built the floor: its column order is the only key to `columns`.
    fingerprint: u64,
    schedule: Schedule,
    round: Round,
    /// Actors that departed this round, in departure order; empty at the barrier.
    departures: Vec<Departure>,
    inbox: Inbox,
    /// Scratch of one turn, cleared before every proposal.
    candidates: Candidates,
    /// Scratch of one turn, cleared before every scan.
    seen: Vec<Seen>,
    /// Harms since the last drain; empty between turns and at every save.
    harms: Vec<Harm>,
    /// Scratch of one row join, cleared before every join.
    harmed: Vec<(Handle, u16)>,
    /// Remains eaten to nothing since the last turn ended; empty between turns.
    emptied: Vec<(EntityId, Handle)>,
    /// What happened since the round started; never saved or hashed.
    events: Vec<Event>,
}

impl Floor {
    #[must_use]
    pub fn new(ruleset: &Ruleset, id: FloorId, shape: Shape) -> Self {
        Self {
            store: Store::new(&ruleset.schema, id),
            grid: Grid::new(shape),
            columns: ruleset
                .columns
                .iter()
                .map(|_| CellColumn::new(shape))
                .collect(),
            scratch: scratch(ruleset, shape),
            fingerprint: ruleset.fingerprint(),
            schedule: Schedule::default(),
            round: Round(0),
            departures: Vec::new(),
            inbox: Inbox::default(),
            candidates: Candidates::default(),
            seen: Vec::new(),
            harms: Vec::new(),
            harmed: Vec::new(),
            emptied: Vec::new(),
            events: Vec::new(),
        }
    }

    /// # Panics
    /// When `at` is not an interior cell of this floor.
    pub fn set_material(&mut self, at: Pos, m: Material) {
        let at = self.interior(at);
        self.grid.set_material(at, m);
    }

    /// # Panics
    /// When `ruleset` is not the one that built this floor, or `at` is not
    /// an interior cell of this floor.
    #[must_use]
    pub fn cell(&self, ruleset: &Ruleset, cells: ReadCells, at: Pos) -> u8 {
        self.check_ruleset(ruleset);
        self.columns[cells.column.index()].get(self.interior(at))
    }

    /// For tests and setup: in a round, only the column's owner writes it.
    ///
    /// # Panics
    /// When `ruleset` is not the one that built this floor, or `at` is not
    /// an interior cell of this floor.
    pub fn set_cell(&mut self, ruleset: &Ruleset, cells: ReadCells, at: Pos, value: u8) {
        self.check_ruleset(ruleset);
        let at = self.interior(at);
        self.columns[cells.column.index()].set(at, value);
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

    /// Species setup by the host, through a read key: the one write without
    /// the write key, so content seeds rows a module owns. Returns the value
    /// `h` held before.
    ///
    /// # Panics
    /// When `h` is dead, or `key` comes from another schema.
    pub fn init<T: Component>(&mut self, key: Read<T>, h: Handle, value: T) -> Option<T> {
        self.store.init(key, h, value)
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

    pub(crate) fn next_counter(&self) -> u64 {
        self.store.next_counter()
    }

    /// The deaths and spawns of the last round, in the order they happened.
    #[must_use]
    pub fn events(&self) -> &[Event] {
        &self.events
    }

    /// The remains named `id`, while they lie on this floor.
    ///
    /// # Panics
    /// When `ruleset` is not the one that built this floor.
    #[must_use]
    pub fn remains(&self, ruleset: &Ruleset, id: EntityId) -> Option<&Remains> {
        self.check_ruleset(ruleset);
        let h = self.store.handle_of(id)?;
        self.store.get(ruleset.remains.read(), h)
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

    fn check_ruleset(&self, ruleset: &Ruleset) {
        assert_eq!(
            self.fingerprint,
            ruleset.fingerprint(),
            "ruleset is not the one that built this floor"
        );
    }
}

fn scratch(ruleset: &Ruleset, shape: Shape) -> Option<CellColumn> {
    (!ruleset.columns.is_empty()).then(|| CellColumn::new(shape))
}
