use korr_ecs::{EntityId, Handle};
use korr_grid::Pos;
use korr_random::Seed;

use crate::action::Prepared;
use crate::config::{IDLE, MAX_INSTEAD, SIGHT};
use crate::ctx::{CommitCtx, Draws, PrepCtx};
use crate::decision::{Candidate, Intent};
use crate::floor::Floor;
use crate::mechanics::Mechanics;
use crate::ruleset::Ruleset;
use crate::senses::{Seen, Senses};
use crate::time::{Cost, Tick};

impl Floor {
    /// Every actor due this round acts on the current state, one at a
    /// time. A departed actor leaves the schedule; its rows travel with it.
    pub(crate) fn run_actors(&mut self, seed: Seed, ruleset: &Ruleset, mechanics: &impl Mechanics) {
        let end = Tick::start_of(self.round + 1);
        while let Some((now, id, actor)) = self.schedule.pop_before(end) {
            let cost = self.turn(seed, ruleset, mechanics, now, id, actor);
            if self.departures.last().map(|d| d.0) == Some(actor) {
                continue;
            }
            let next = now.after(cost);
            self.store.insert(&ruleset.clock, actor, next);
            self.schedule.push(next, id, actor);
        }
    }

    /// One pick, and one more without it when its run fails; a second failure idles.
    fn turn(
        &mut self,
        seed: Seed,
        ruleset: &Ruleset,
        mechanics: &impl Mechanics,
        now: Tick,
        id: EntityId,
        actor: Handle,
    ) -> Cost {
        let pos = self.grid.pos(actor).expect("a due actor is placed");
        self.seen.clear();
        if mechanics.perceives() {
            self.look(actor, pos);
        }
        self.candidates.clear();
        mechanics.propose(&Senses::new(pos, &self.seen), &mut self.candidates);
        let intent = self.store.get(ruleset.intent.read(), actor).copied();
        let mut excluded = None;
        while let Some(pick) = self.candidates.pick(intent, excluded) {
            if let Some(cost) = self.run(seed, mechanics, now, id, actor, pick) {
                let intent = Intent {
                    action: pick.action.key(),
                    target: pick.target,
                };
                self.store.insert(&ruleset.intent, actor, intent);
                return cost;
            }
            if excluded.is_some() {
                break;
            }
            excluded = Some(pick.action.key());
        }
        self.store.remove(&ruleset.intent, actor);
        IDLE
    }

    /// The other actors within `SIGHT` of `pos`, in neighbourhood order.
    fn look(&mut self, actor: Handle, pos: Pos) {
        let shape = self.grid.shape();
        for at in shape.neighbourhood(pos, SIGHT) {
            let cell = at.cell();
            if let Some(other) = self.grid.actor_at(cell).filter(|&other| other != actor) {
                let id = self.store.id(other).expect("a placed actor is alive");
                self.seen.push(Seen {
                    id,
                    pos: shape.pos(cell),
                });
            }
        }
    }

    /// The cost of a run that ends in `Go` or `Blocked`; `None` when it fails.
    fn run(
        &mut self,
        seed: Seed,
        mechanics: &impl Mechanics,
        now: Tick,
        id: EntityId,
        actor: Handle,
        pick: Candidate,
    ) -> Option<Cost> {
        let (mut action, mut target) = (pick.action, pick.target);
        let floor = self.id();
        let mut hops = 0;
        loop {
            let draws = Draws::new(seed, action, now, id);
            let prep = PrepCtx {
                grid: &self.grid,
                actor,
                id,
                floor,
                draws,
                now,
            };
            match mechanics.prepare(action, target, &prep) {
                Prepared::Go { cost } => {
                    let mut commit = CommitCtx {
                        grid: &mut self.grid,
                        actor,
                        draws,
                        departures: &mut self.departures,
                    };
                    mechanics.commit(action, target, &mut commit);
                    return Some(cost);
                }
                Prepared::Blocked => return Some(IDLE),
                Prepared::Instead {
                    action: next,
                    target: next_target,
                } => {
                    hops += 1;
                    if hops > MAX_INSTEAD {
                        return None;
                    }
                    action = next;
                    target = next_target;
                }
                Prepared::Fail => return None,
            }
        }
    }
}
