use korr_ecs::{Handle, Traveller};
use korr_grid::Interior;

use crate::floor::Floor;
use crate::ruleset::Ruleset;
use crate::time::Tick;

#[derive(Debug)]
pub(crate) enum Joiner {
    Spawned,
    Arrived(Traveller),
}

impl Floor {
    /// Spawns or attaches, links at `at`, writes the clock, then schedules.
    ///
    /// # Panics
    /// When an arriving traveller fails attach: "an inbox traveller was checked".
    pub(crate) fn join_actor(
        &mut self,
        ruleset: &Ruleset,
        joiner: Joiner,
        at: Interior,
        clock: Tick,
    ) -> Handle {
        let h = match joiner {
            Joiner::Spawned => self.store.spawn(),
            Joiner::Arrived(t) => self
                .store
                .attach(t)
                .expect("an inbox traveller was checked"),
        };
        self.grid.link_actor(&self.store, h, at);
        let id = self.store.id(h).expect("a joined handle is alive");
        self.store.insert(&ruleset.clock, h, clock);
        self.schedule.push(clock, id, h);
        h
    }

    pub(crate) fn join_thing(&mut self, at: Interior) -> Handle {
        let h = self.store.spawn();
        self.grid.link_thing(&self.store, h, at);
        h
    }

    /// Unlinks, then detaches: the slot is recycled after.
    pub(crate) fn leave(&mut self, h: Handle) -> Traveller {
        self.grid.unlink(h);
        self.store.detach(h)
    }
}
