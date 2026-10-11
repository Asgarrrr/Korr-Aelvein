use alloc::collections::{BTreeMap, BTreeSet};
use alloc::vec::Vec;

use korr_ecs::{EntityId, Handle, ImageError, Reader, Store, Traveller, Writer, checksum};
use korr_grid::{Grid, Pos};

use crate::config::TICKS_PER_ROUND;
use crate::decision::Candidates;
use crate::error::LoadError;
use crate::floor::Floor;
use crate::floor::inbox::{Flight, Inbox};
use crate::floor::schedule::Schedule;
use crate::ruleset::Ruleset;

const CHECKSUM_LEN: usize = 8;

impl Floor {
    /// `u64` round, `u64` ruleset fingerprint, `u32` store image length, the
    /// store image, the grid, the inbox, then a `u64` checksum of every byte
    /// before it. The inbox is a `u32` count, then per flight a `u64` round,
    /// `i16` x, `i16` y and the traveller. Saves happen only at the barrier: no
    /// `&Floor` exists mid-round.
    ///
    /// # Panics
    /// When the store image or the inbox exceeds `u32::MAX` bytes or flights.
    #[must_use]
    pub fn save(&self, ruleset: &Ruleset) -> Vec<u8> {
        let store = self.store.save();
        let mut w = Writer::new();
        w.write_u64(self.round);
        w.write_u64(ruleset.fingerprint());
        w.write_u32(u32::try_from(store.len()).expect("a store image fits u32 bytes"));
        w.write_bytes(&store);
        self.grid.write(&mut w);
        let flights = self.inbox.flights();
        w.write_u32(u32::try_from(flights.len()).expect("an inbox fits u32 flights"));
        for flight in flights {
            w.write_u64(flight.round);
            w.write_i16(flight.at.x);
            w.write_i16(flight.at.y);
            flight.traveller.write(&mut w);
        }
        let mut bytes = w.into_bytes();
        let sum = checksum(&bytes);
        bytes.extend_from_slice(&sum.to_le_bytes());
        bytes
    }

    /// Rebuilds the schedule from the clock column. Never panics.
    ///
    /// # Errors
    /// [`LoadError::Ruleset`] when the image was saved under another ruleset.
    /// [`LoadError::Image`] for a truncated, altered or overlong image, the errors
    /// of `Store::load`, `Grid::read` and `Store::check_arrival`, or
    /// [`ImageError::Corrupt`] with:
    /// - `"round"`: a round whose ticks overflow;
    /// - `"clock of an unplaced actor"`: a clock row of an entity no cell holds as its actor;
    /// - `"clock out of range"`: a clock before the round or past one maximal cost after it;
    /// - `"inbox order"`: flights not strictly ascending by round, then `EntityId`;
    /// - `"inbox round"`: a flight that left in this round or later;
    /// - `"inbox duplicate id"`: a flight whose id is alive on the floor or waits twice;
    /// - `"placed actor without a clock"`: an actor a cell holds that has no clock row.
    pub fn load(ruleset: &Ruleset, bytes: &[u8]) -> Result<Self, LoadError> {
        if bytes.len() < CHECKSUM_LEN {
            return Err(ImageError::Truncated { at: bytes.len() }.into());
        }
        let (body, sum) = bytes.split_at(bytes.len() - CHECKSUM_LEN);
        if Reader::new(sum).read_u64()? != checksum(body) {
            return Err(ImageError::Checksum.into());
        }

        let mut r = Reader::new(body);
        let round = r.read_u64()?;
        let saved = r.read_u64()?;
        if saved != ruleset.fingerprint() {
            return Err(LoadError::Ruleset {
                saved,
                running: ruleset.fingerprint(),
            });
        }
        let len = r.read_u32()?;
        let store = Store::load(&ruleset.schema, r.read_bytes(len as usize)?)?;
        let handles: BTreeMap<EntityId, Handle> = store
            .handles()
            .filter_map(|h| Some((store.id(h)?, h)))
            .collect();
        let grid = Grid::read(&mut r, |id| handles.get(&id).copied())?;
        let mut inbox = Inbox::default();
        let mut taken: BTreeSet<_> = store.handles().filter_map(|h| store.id(h)).collect();
        for _ in 0..r.read_u32()? {
            let flight = Flight {
                round: r.read_u64()?,
                at: Pos {
                    x: r.read_i16()?,
                    y: r.read_i16()?,
                },
                traveller: Traveller::read(&mut r)?,
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
            if !taken.insert(flight.traveller.id()) {
                return Err(ImageError::Corrupt("inbox duplicate id").into());
            }
            store.check_arrival(&flight.traveller)?;
            inbox.insert(flight);
        }
        r.finish()?;

        let margin = u64::from(u32::MAX);
        let start = round
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
            grid,
            schedule,
            round,
            departures: Vec::new(),
            inbox,
            candidates: Candidates::default(),
            seen: Vec::new(),
        })
    }
}

fn holds_as_actor(grid: &Grid, h: Handle) -> bool {
    grid.pos(h)
        .and_then(|p| grid.shape().idx(p))
        .is_some_and(|at| grid.actor_at(at.cell()) == Some(h))
}
