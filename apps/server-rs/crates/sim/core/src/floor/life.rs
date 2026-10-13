use alloc::vec::Vec;
use core::mem;

use korr_ecs::{EntityId, Handle};
use korr_grid::Layer;

use crate::config::ROT_PER_ROUND;
use crate::floor::Floor;
use crate::life::{Event, Remains};
use crate::ruleset::Ruleset;

impl Floor {
    #[inline]
    pub(crate) fn drain(&mut self, ruleset: &Ruleset) {
        if !self.harms.is_empty() {
            self.settle(ruleset);
        }
    }

    /// Sums the harms per target and kills, in id order, each target they
    /// bring to zero, credited to its lowest cause; then lays the remains.
    #[cold]
    fn settle(&mut self, ruleset: &Ruleset) {
        let mut harms = mem::take(&mut self.harms);
        harms.sort_unstable();
        let mut spawns = Vec::new();
        for group in harms.chunk_by(|a, b| a.0 == b.0) {
            let (id, cause, _) = group[0];
            let Some(h) = self.store.handle_of(id) else {
                continue;
            };
            let Some(vitality) = self.store.get_mut(&ruleset.vitality, h) else {
                continue;
            };
            let total = group.iter().fold(0u32, |sum, &(.., amount)| {
                sum.saturating_add(u32::from(amount))
            });
            vitality.hp = vitality
                .hp
                .saturating_sub(u16::try_from(total).unwrap_or(u16::MAX));
            if vitality.hp > 0 {
                continue;
            }
            let mass = vitality.max;
            // A departing actor stays harmable until the barrier sends it.
            self.departures.retain(|d| d.actor != h);
            let pos = self.grid.pos(h).expect("a live entity is placed");
            self.grid.unlink(h);
            self.store.despawn(h);
            if mass > 0 {
                spawns.push((cause, id, pos, mass));
            }
            self.events.push(Event::Died { id, cause });
        }
        harms.clear();
        self.harms = harms;
        spawns.sort_unstable_by_key(|&(cause, of, ..)| (cause, of));
        for (cause, of, pos, mass) in spawns {
            let Some(at) = self.grid.nearest_place(pos, Layer::Thing) else {
                continue;
            };
            let h = self.join_thing(at);
            self.store.insert(&ruleset.remains, h, Remains { of, mass });
            let id = self.store.id(h).expect("a spawned thing is alive");
            self.events.push(Event::Spawned { id, cause });
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
        self.clear(&mut rotten);
        self.emptied = rotten;
    }

    /// The remains the last action ate to nothing leave.
    #[inline]
    pub(crate) fn clear_emptied(&mut self) {
        if !self.emptied.is_empty() {
            let mut emptied = mem::take(&mut self.emptied);
            self.clear(&mut emptied);
            self.emptied = emptied;
        }
    }

    /// Unlinks and despawns `things` in id order, and empties the list.
    #[cold]
    fn clear(&mut self, things: &mut Vec<(EntityId, Handle)>) {
        things.sort_unstable_by_key(|&(id, _)| id);
        for (_, h) in things.drain(..) {
            self.grid.unlink(h);
            self.store.despawn(h);
        }
    }
}
