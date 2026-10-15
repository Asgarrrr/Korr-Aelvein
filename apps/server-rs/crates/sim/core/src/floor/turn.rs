use korr_ecs::{AnyRead, EntityId, Handle, Lent, Store};
use korr_grid::Pos;
use korr_random::Seed;

use crate::config::{IDLE, MAX_INSTEAD, SIGHT};
use crate::ctx::{CommitCtx, Draws, PrepCtx, departed};
use crate::decision::{Candidate, Candidates, Intent};
use crate::floor::Floor;
use crate::module::{Action, Mechanics, Module, Prepared, Proposals, Visit, index_of, module_key};
use crate::ruleset::Ruleset;
use crate::senses::{Seen, Senses};
use crate::time::{Cost, Tick};

/// The core's per-actor columns, out of the store while the actors run.
pub(crate) struct Lents {
    clock: Lent<Tick>,
    intent: Lent<Intent>,
}

impl Lents {
    /// Every despawn while lent calls it, so a reused slot starts without them.
    pub(crate) fn clear(&mut self, h: Handle) {
        self.clock.clear(h);
        self.intent.clear(h);
    }
}

impl Floor {
    /// Every actor due this round acts on the current state, one at a
    /// time, and its harms land before the next acts. A departed or dead
    /// actor leaves the schedule; a departed one's rows travel with it.
    pub(crate) fn run_actors(&mut self, seed: Seed, ruleset: &Ruleset, mechanics: &impl Mechanics) {
        let end = Tick::start_of(self.round.next());
        let mut lents = Lents {
            clock: self.store.lend(&ruleset.clock),
            intent: self.store.lend(&ruleset.intent),
        };
        while let Some((now, id, actor)) = self.schedule.pop_before(end) {
            // The link compares generations: a due of the dead or of a recycled slot is unplaced.
            let Some(pos) = self.grid.pos(actor) else {
                continue;
            };
            let placed = Placed {
                now,
                id,
                actor,
                pos,
            };
            let cost = self.turn(seed, ruleset, mechanics, placed, &mut lents.intent);
            self.drain(ruleset, Some(&mut lents));
            self.clear_emptied(&mut lents);
            if !self.store.is_alive(actor) || departed(&self.departures, actor) {
                continue;
            }
            let next = now.after(cost);
            lents.clock.insert(&self.store, actor, next);
            self.schedule.push(next, id, actor);
        }
        self.store.restore(lents.clock);
        self.store.restore(lents.intent);
    }

    /// One pick, and one more without it when its run fails; a second failure idles.
    fn turn(
        &mut self,
        seed: Seed,
        ruleset: &Ruleset,
        mechanics: &impl Mechanics,
        placed: Placed,
        intents: &mut Lent<Intent>,
    ) -> Cost {
        let Placed {
            now,
            id,
            actor,
            pos,
        } = placed;
        self.seen.clear();
        if ruleset.perceives {
            self.look(actor, pos);
        }
        self.candidates.clear();
        mechanics.each(&mut ProposeVisit {
            ruleset,
            senses: Senses::new(
                pos,
                &self.seen,
                &self.store,
                actor,
                &self.grid,
                &self.columns,
                ruleset,
            ),
            out: &mut self.candidates,
            ordinal: 0,
        });
        let intent = intents.get(&self.store, actor).copied();
        let mut excluded = None;
        while let Some(pick) = self.candidates.pick(intent, excluded) {
            let mut run = RunVisit {
                floor: self,
                ruleset,
                seed,
                now,
                id,
                actor,
                pick,
                ordinal: 0,
                routed: false,
                cost: None,
            };
            mechanics.each(&mut run);
            assert!(run.routed, "a candidate's module runs in this ruleset");
            if let Some(cost) = run.cost {
                let intent = Intent {
                    action: pick.action.key,
                    target: pick.target,
                };
                intents.insert(&self.store, actor, intent);
                return cost;
            }
            if excluded.is_some() {
                break;
            }
            excluded = Some(pick.action.key);
        }
        intents.remove(&self.store, actor);
        IDLE
    }

    /// The other actors within `SIGHT` of `pos`, in neighbourhood order. A row-major
    /// scan then a stable sort by ring beats walking the rings cell by cell.
    fn look(&mut self, actor: Handle, pos: Pos) {
        let shape = self.grid.shape();
        let (grid, store, seen) = (&self.grid, &self.store, &mut self.seen);
        shape.scan_rings(pos, SIGHT, |p, at| {
            if let Some(other) = grid.actor_at(at.cell()).filter(|&other| other != actor) {
                let id = store.id(other).expect("a placed actor is alive");
                seen.push(Seen {
                    id,
                    pos: p,
                    handle: other,
                });
            }
        });
    }
}

/// A popped due whose actor is still placed.
#[derive(Clone, Copy)]
struct Placed {
    now: Tick,
    id: EntityId,
    actor: Handle,
    pos: Pos,
}

/// Hands each module a `Proposals` bound to its ordinal and action keys.
struct ProposeVisit<'a> {
    ruleset: &'a Ruleset,
    senses: Senses<'a>,
    out: &'a mut Candidates,
    ordinal: usize,
}

impl Visit for ProposeVisit<'_> {
    fn module<M: Module>(&mut self, module: &M) {
        let entry = &self.ruleset.modules[self.ordinal];
        debug_assert_eq!(entry.key, module_key::<M>());
        let ordinal = u16::try_from(self.ordinal).expect("a module table fits u16");
        module.propose(
            &self.senses,
            &mut Proposals::new(self.out, ordinal, &entry.actions),
        );
        self.ordinal += 1;
    }
}

/// Runs the picked candidate in the module whose ordinal it carries.
struct RunVisit<'a> {
    floor: &'a mut Floor,
    ruleset: &'a Ruleset,
    seed: Seed,
    now: Tick,
    id: EntityId,
    actor: Handle,
    pick: Candidate,
    ordinal: usize,
    routed: bool,
    /// The cost of a run that ends in `Go` or `Blocked`; `None` when it fails.
    cost: Option<Cost>,
}

impl Visit for RunVisit<'_> {
    fn module<M: Module>(&mut self, module: &M) {
        if self.ordinal == usize::from(self.pick.action.module) {
            self.routed = true;
            self.cost = self.run(module);
        }
        self.ordinal += 1;
    }
}

impl RunVisit<'_> {
    fn run<M: Module>(&mut self, module: &M) -> Option<Cost> {
        let requires = &self.ruleset.modules[self.ordinal].requires;
        let mut index = usize::from(self.pick.action.index);
        let mut action = M::Action::ALL[index];
        let mut target = self.pick.target;
        let floor = self.floor.id();
        let draws = Draws::new(self.seed, module_key::<M>(), self.now, self.id);
        let mut hops = 0;
        if !holds(&self.floor.store, self.actor, &requires[index]) {
            return None;
        }
        loop {
            let store = &self.floor.store;
            let prep = PrepCtx {
                grid: &self.floor.grid,
                store,
                actor: self.actor,
                id: self.id,
                floor,
                draws,
                now: self.now,
                columns: &self.floor.columns,
                names: &self.ruleset.columns,
            };
            match module.prepare(action, target, &prep) {
                Prepared::Go { cost, plan } => {
                    let mut commit = CommitCtx {
                        grid: &mut self.floor.grid,
                        actor: self.actor,
                        id: self.id,
                        departures: &mut self.floor.departures,
                        store: &mut self.floor.store,
                        columns: &mut self.floor.columns,
                        ruleset: self.ruleset,
                        harms: &mut self.floor.harms,
                        emptied: &mut self.floor.emptied,
                    };
                    module.commit(plan, &mut commit);
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
                    let next_index = index_of(next);
                    // A run cannot change the store before its commit: equal keys still hold.
                    if requires[next_index] != requires[index]
                        && !holds(store, self.actor, &requires[next_index])
                    {
                        return None;
                    }
                    index = next_index;
                    action = next;
                    target = next_target;
                }
                Prepared::Fail => return None,
            }
        }
    }
}

fn holds(store: &Store, actor: Handle, keys: &[AnyRead]) -> bool {
    keys.iter().all(|&key| store.has(key, actor))
}
