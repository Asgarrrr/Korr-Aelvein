use alloc::collections::BTreeSet;
use alloc::vec::Vec;

use korr_ecs::{Handle, ImageError, Reader, Store, Traveller, Writer};
use korr_grid::{CellColumn, Grid};

use crate::config::TICKS_PER_ROUND;
use crate::decision::Candidates;
use crate::error::LoadError;
use crate::floor::inbox::{Flight, Inbox};
use crate::floor::schedule::Schedule;
use crate::floor::sections::{FlightImage, Sections};
use crate::floor::{Floor, Recording};
use crate::ruleset::Ruleset;

impl Floor {
    /// The [`Sections`] of this floor, sealed. Saves happen only at the
    /// barrier: no `&Floor` exists mid-round.
    ///
    /// # Panics
    /// When `ruleset` is not the one that built this floor, or the store image,
    /// the grid image, the columns, a traveller or the inbox exceeds `u32::MAX`
    /// bytes or flights.
    #[must_use]
    pub fn save(&self, ruleset: &Ruleset) -> Vec<u8> {
        self.check_ruleset(ruleset);
        let mut grid = Writer::new();
        self.grid.write(&mut grid);
        let mut columns = Writer::new();
        for column in &self.columns {
            column.write(&mut columns);
        }
        let flights = self
            .inbox
            .flights()
            .iter()
            .map(|flight| {
                let mut traveller = Writer::new();
                flight.traveller.write(&mut traveller);
                FlightImage {
                    round: flight.round,
                    at: flight.at,
                    traveller: traveller.into_bytes(),
                }
            })
            .collect();
        Sections {
            round: self.round,
            fingerprint: ruleset.fingerprint(),
            store: self.store.save(),
            grid: grid.into_bytes(),
            columns: columns.into_bytes(),
            flights,
        }
        .seal()
    }

    /// Rebuilds the schedule from the clock column. Never panics.
    ///
    /// # Errors
    /// [`LoadError::Ruleset`] when the image was saved under another ruleset.
    /// [`LoadError::Image`] for the errors of [`Sections::parse`], `Store::load`,
    /// `Grid::read`, `CellColumn::read`, `Traveller::read` and `Store::check_arrival`,
    /// trailing bytes in the grid, the columns or a traveller, or [`ImageError::Corrupt`] with:
    /// - `"round"`: a round whose ticks overflow;
    /// - `"clock of an unplaced actor"`: a clock row of an entity no cell holds as its actor;
    /// - `"clock out of range"`: a clock before the round or past one maximal cost after it;
    /// - `"inbox order"`: flights not strictly ascending by round, then `EntityId`;
    /// - `"inbox round"`: a flight that left in this round or later;
    /// - `"inbox duplicate id"`: a flight whose id is alive on the floor or waits twice;
    /// - `"placed actor without a clock"`: an actor a cell holds that has no clock row.
    pub fn load(ruleset: &Ruleset, bytes: &[u8]) -> Result<Self, LoadError> {
        let sections = Sections::parse(bytes)?;
        if sections.fingerprint != ruleset.fingerprint() {
            return Err(LoadError::Ruleset {
                saved: sections.fingerprint,
                running: ruleset.fingerprint(),
            });
        }
        let round = sections.round;
        let store = Store::load(&ruleset.schema, &sections.store)?;
        let mut r = Reader::new(&sections.grid);
        let grid = Grid::read(&mut r, &store, |id| store.handle_of(id))?;
        r.finish()?;
        let mut r = Reader::new(&sections.columns);
        let columns = ruleset
            .columns
            .iter()
            .map(|_| CellColumn::read(&mut r, grid.shape()))
            .collect::<Result<Vec<_>, _>>()?;
        r.finish()?;
        let mut inbox = Inbox::default();
        let mut waiting = BTreeSet::new();
        for image in &sections.flights {
            let mut r = Reader::new(&image.traveller);
            let traveller = Traveller::read(&mut r)?;
            r.finish()?;
            let flight = Flight {
                round: image.round,
                at: image.at,
                traveller,
            };
            if inbox
                .flights()
                .last()
                .is_some_and(|last| last.key() >= flight.key())
            {
                return Err(ImageError::Corrupt("inbox order").into());
            }
            if flight.round >= round {
                return Err(ImageError::Corrupt("inbox round").into());
            }
            let id = flight.traveller.id();
            if store.handle_of(id).is_some() || !waiting.insert(id) {
                return Err(ImageError::Corrupt("inbox duplicate id").into());
            }
            store.check_arrival(&flight.traveller)?;
            inbox.insert(flight);
        }

        let margin = u64::from(u32::MAX);
        let start = round
            .0
            .checked_mul(TICKS_PER_ROUND)
            .filter(|start| start.checked_add(margin).is_some())
            .ok_or(ImageError::Corrupt("round"))?;
        let mut schedule = Schedule::default();
        for (h, &clock) in store.iter(ruleset.clock.read()) {
            let id = store
                .id(h)
                .filter(|_| holds_as_actor(&grid, h))
                .ok_or(ImageError::Corrupt("clock of an unplaced actor"))?;
            if !(start..=start + margin).contains(&clock.0) {
                return Err(ImageError::Corrupt("clock out of range").into());
            }
            schedule.push(clock, id, h);
        }
        if store
            .handles()
            .any(|h| holds_as_actor(&grid, h) && store.get(ruleset.clock.read(), h).is_none())
        {
            return Err(ImageError::Corrupt("placed actor without a clock").into());
        }
        Ok(Self {
            store,
            scratch: super::scratch(ruleset, grid.shape()),
            grid,
            columns,
            fingerprint: ruleset.fingerprint(),
            schedule,
            round,
            departures: Vec::new(),
            inbox,
            candidates: Candidates::default(),
            seen: Vec::new(),
            harms: Vec::new(),
            harmed: Vec::new(),
            deaths: Vec::new(),
            emptied: Vec::new(),
            events: Vec::new(),
            event_count: 0,
            recording: Recording::Kept,
        })
    }
}

fn holds_as_actor(grid: &Grid, h: Handle) -> bool {
    grid.pos(h)
        .and_then(|p| grid.shape().idx(p))
        .is_some_and(|at| grid.actor_at(at.cell()) == Some(h))
}
