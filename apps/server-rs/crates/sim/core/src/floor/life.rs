use alloc::vec::Vec;
use core::mem;

use korr_ecs::{EntityId, Handle};
use korr_grid::{Layer, Pos};

use crate::config::{EVENTS_PER_ROUND, ROT_PER_ROUND};
use crate::floor::turn::Lents;
use crate::floor::{Floor, Recording};
use crate::life::{Cause, Event, Harm, Remains, Vitality};
use crate::ruleset::Ruleset;

/// A target its harms brought to zero, until its remains lie.
#[derive(Debug)]
pub(super) struct Death {
    id: EntityId,
    cause: Cause,
    h: Handle,
    pos: Pos,
    /// `Vitality::max`, the mass of its remains.
    mass: u16,
}

impl Floor {
    /// `lents` while the actors run, `None` outside.
    #[inline]
    pub(crate) fn drain(&mut self, ruleset: &Ruleset, lents: Option<&mut Lents>) {
        if !self.harms.is_empty() {
            self.settle(ruleset, lents);
        }
    }

    /// Sums the harms per target and kills, in id order, each target they
    /// bring to zero, credited to its lowest cause; then lays the remains.
    #[cold]
    fn settle(&mut self, ruleset: &Ruleset, lents: Option<&mut Lents>) {
        debug_assert!(self.deaths.is_empty());
        let mut harms = mem::take(&mut self.harms);
        harms.sort_unstable_by_key(|harm| (harm.target, harm.cause));
        let mut vitality = self.store.lend(&ruleset.vitality);
        for group in harms.chunk_by(|a, b| a.target == b.target) {
            let Harm {
                target: id,
                h,
                cause,
                ..
            } = group[0];
            let Some(&Vitality { hp, max }) = vitality.get(&self.store, h) else {
                continue;
            };
            let total = group
                .iter()
                .fold(0u32, |sum, harm| sum.saturating_add(u32::from(harm.amount)));
            let hp = hp.saturating_sub(u16::try_from(total).unwrap_or(u16::MAX));
            vitality.insert(&self.store, h, Vitality { hp, max });
            if hp == 0 {
                let pos = self.grid.pos(h).expect("a live entity is placed");
                self.deaths.push(Death {
                    id,
                    cause,
                    h,
                    pos,
                    mass: max,
                });
            }
        }
        self.store.restore(vitality);
        harms.clear();
        self.harms = harms;
        if !self.deaths.is_empty() {
            self.bury(ruleset, lents);
        }
    }

    /// Unlinks and despawns the dead in id order, then lays their remains in cause order.
    #[cold]
    fn bury(&mut self, ruleset: &Ruleset, mut lents: Option<&mut Lents>) {
        let mut deaths = mem::take(&mut self.deaths);
        for &Death { id, cause, h, .. } in &deaths {
            self.grid.unlink(h);
            if let Some(lents) = lents.as_deref_mut() {
                lents.clear(h);
            }
            self.store.despawn(h);
            self.record(Event::Died { id, cause });
        }
        // A departing actor stays harmable until the barrier sends it.
        self.departures
            .retain(|d| !deaths.iter().any(|death| death.h == d.actor));
        deaths.sort_unstable_by_key(|death| (death.cause, death.id));
        for &Death {
            id,
            cause,
            pos,
            mass,
            ..
        } in &deaths
        {
            if mass == 0 {
                continue;
            }
            let Some(at) = self.grid.nearest_place(pos, Layer::Thing) else {
                continue;
            };
            let h = self.join_thing(at);
            self.store
                .insert(&ruleset.remains, h, Remains { of: id, mass });
            let id = self.store.id(h).expect("a spawned thing is alive");
            self.record(Event::Spawned { id, cause });
        }
        deaths.clear();
        self.deaths = deaths;
    }

    /// # Panics
    /// When the round has raised more than `EVENTS_PER_ROUND` events.
    fn record(&mut self, event: Event) {
        self.event_count += 1;
        assert!(
            self.event_count <= EVENTS_PER_ROUND,
            "more than {EVENTS_PER_ROUND} events in one round"
        );
        if self.recording == Recording::Kept {
            self.events.push(event);
        }
    }

    /// Every remains loses `ROT_PER_ROUND` mass; those it empties leave.
    pub(crate) fn rot(&mut self, ruleset: &Ruleset) {
        let mut rotten = false;
        for remains in self.store.values_mut(&ruleset.remains) {
            remains.mass = remains.mass.saturating_sub(ROT_PER_ROUND);
            rotten |= remains.mass == 0;
        }
        if rotten {
            self.clear_rotten(ruleset);
        }
    }

    /// Lists the rotten in `emptied`, which is empty between turns.
    #[cold]
    fn clear_rotten(&mut self, ruleset: &Ruleset) {
        debug_assert!(self.emptied.is_empty());
        let mut rotten = mem::take(&mut self.emptied);
        rotten.extend(
            self.store
                .iter(ruleset.remains.read())
                .filter(|(_, remains)| remains.mass == 0)
                .map(|(h, _)| (self.store.id(h).expect("a stored row is alive"), h)),
        );
        self.clear(&mut rotten, None);
        self.emptied = rotten;
    }

    /// The remains the last action ate to nothing leave.
    #[inline]
    pub(crate) fn clear_emptied(&mut self, lents: &mut Lents) {
        if !self.emptied.is_empty() {
            let mut emptied = mem::take(&mut self.emptied);
            self.clear(&mut emptied, Some(lents));
            self.emptied = emptied;
        }
    }

    /// Unlinks and despawns `things` in id order, and empties the list.
    #[cold]
    fn clear(&mut self, things: &mut Vec<(EntityId, Handle)>, mut lents: Option<&mut Lents>) {
        things.sort_unstable_by_key(|&(id, _)| id);
        for (_, h) in things.drain(..) {
            self.grid.unlink(h);
            if let Some(lents) = lents.as_deref_mut() {
                lents.clear(h);
            }
            self.store.despawn(h);
        }
    }
}
