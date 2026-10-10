use alloc::vec::Vec;
use core::ptr;

use korr_core::{
    ActionDesc, Band, Candidate, Candidates, CommitCtx, Cost, Dir, Mechanics, PrepCtx, Prepared,
    Senses, Target, Tick,
};

/// A fake mechanic whose candidates and answers are fixed by the test.
#[derive(Debug)]
pub struct Scripted(pub Vec<Act>);

#[derive(Debug, Clone, Copy)]
pub struct Act {
    pub desc: &'static ActionDesc,
    pub band: Band,
    pub weight: u16,
    pub target: Target,
    pub answer: Answer,
}

#[derive(Debug, Clone, Copy)]
pub enum Answer {
    Go(Dir),
    Instead(&'static ActionDesc),
    Fail,
    FailBefore(Tick, Dir),
}

impl Scripted {
    fn act(&self, action: &'static ActionDesc, target: Target) -> &Act {
        self.0
            .iter()
            .find(|act| act.desc.key() == action.key() && act.target == target)
            .expect("the script answers only what it proposed")
    }
}

impl Mechanics for Scripted {
    fn actions(&self, out: &mut Vec<&'static ActionDesc>) {
        for act in &self.0 {
            if !out.iter().any(|&desc| ptr::eq(desc, act.desc)) {
                out.push(act.desc);
            }
        }
    }

    fn perceives(&self) -> bool {
        false
    }

    fn propose(&self, _: &Senses<'_>, out: &mut Candidates) {
        for act in &self.0 {
            out.push(Candidate {
                action: act.desc,
                band: act.band,
                weight: act.weight,
                target: act.target,
            });
        }
    }

    fn prepare(&self, action: &'static ActionDesc, target: Target, ctx: &PrepCtx<'_>) -> Prepared {
        match self.act(action, target).answer {
            Answer::Instead(next) => Prepared::Instead {
                action: next,
                target: Target::None,
            },
            Answer::FailBefore(at, _) if ctx.now() < at => Prepared::Fail,
            Answer::Go(dir) | Answer::FailBefore(_, dir) => match ctx.check_step(dir) {
                Ok(_) => Prepared::Go {
                    cost: Cost::new(100),
                },
                Err(_) => Prepared::Blocked,
            },
            Answer::Fail => Prepared::Fail,
        }
    }

    fn commit(&self, action: &'static ActionDesc, target: Target, ctx: &mut CommitCtx<'_>) {
        match self.act(action, target).answer {
            Answer::Go(dir) | Answer::FailBefore(_, dir) => {
                ctx.step(dir);
            }
            Answer::Instead(_) | Answer::Fail => {
                panic!("commit of an answer that never goes")
            }
        }
    }
}
