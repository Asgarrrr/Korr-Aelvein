use alloc::vec::Vec;

use crate::ruleset::Ruleset;

use super::World;

impl World {
    /// Every floor sends, each flight joins its destination's inbox, every floor lands, then the round ends.
    /// Arrivals act next round and the inbox is ordered, so the floor order never changes a result.
    ///
    /// # Panics
    /// When a flight leaves for a floor outside this world.
    pub(super) fn barrier(&mut self, ruleset: &Ruleset) {
        let mut flights = Vec::new();
        for floor in &mut self.floors {
            flights.extend(floor.send());
        }
        for (to, flight) in flights {
            let at = self
                .position(to)
                .expect("departure to a floor outside this world");
            self.floors[at].receive(flight);
        }
        for floor in &mut self.floors {
            floor.land(ruleset);
        }
        for floor in &mut self.floors {
            floor.end_round();
        }
    }
}
