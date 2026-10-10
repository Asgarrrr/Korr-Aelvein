use korr_ecs::{EntityId, Handle};
use korr_random::Seed;

use crate::action::Prepared;
use crate::config::IDLE;
use crate::ctx::{CommitCtx, Draws, PrepCtx};
use crate::floor::Floor;
use crate::mechanics::Mechanics;
use crate::time::{Cost, Tick};

impl Floor {
    /// Phase 2: every actor due this round acts on the current state, one at a time.
    pub(crate) fn run_actors(&mut self, seed: Seed, mechanics: &impl Mechanics) {
        let end = Tick::start_of(self.round + 1);
        while let Some((now, id, actor)) = self.schedule.pop_before(end) {
            let cost = self.turn(seed, mechanics, now, id, actor);
            self.schedule.push(now.after(cost), id, actor);
        }
    }

    fn turn(
        &mut self,
        seed: Seed,
        mechanics: &impl Mechanics,
        now: Tick,
        id: EntityId,
        actor: Handle,
    ) -> Cost {
        self.candidates.clear();
        mechanics.propose(&mut self.candidates);
        let Some(action) = self.candidates.pick() else {
            return IDLE;
        };
        let draws = Draws::new(seed, action, now, id);
        let prep = PrepCtx {
            grid: &self.grid,
            actor,
            id,
            draws,
        };
        match mechanics.prepare(action, &prep) {
            Prepared::Go { cost } => {
                let mut commit = CommitCtx {
                    grid: &mut self.grid,
                    actor,
                    draws,
                };
                mechanics.commit(action, &mut commit);
                cost
            }
            Prepared::Blocked => IDLE,
        }
    }
}
