use alloc::vec::Vec;

use korr_core::mechanic::{
    Action, Band, CommitCtx, Cost, Dir, Module, PrepCtx, Prepared, Proposals, Senses, Target, Tick,
};

/// A fake mechanic whose candidates and answers are fixed by the test.
#[derive(Debug)]
pub struct Scripted(pub Vec<Act>);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Fake {
    X,
    Y,
    Z,
}

impl Action for Fake {
    const ALL: &'static [Self] = &[Self::X, Self::Y, Self::Z];

    fn name(self) -> &'static str {
        match self {
            Self::X => "x",
            Self::Y => "y",
            Self::Z => "z",
        }
    }
}

#[derive(Debug, Clone, Copy)]
pub struct Act {
    pub action: Fake,
    pub band: Band,
    pub weight: u16,
    pub target: Target,
    pub answer: Answer,
}

#[derive(Debug, Clone, Copy)]
pub enum Answer {
    Go(Dir),
    Instead(Fake),
    Fail,
    FailBefore(Tick, Dir),
}

impl Scripted {
    fn act(&self, action: Fake, target: Target) -> &Act {
        self.0
            .iter()
            .find(|act| act.action == action && act.target == target)
            .expect("the script answers only what it proposed")
    }
}

impl Module for Scripted {
    const NAME: &'static str = "fake";
    type Action = Fake;
    type Plan = Dir;

    fn propose(&self, _: &Senses<'_>, out: &mut Proposals<'_, Fake>) {
        for act in &self.0 {
            out.push(act.action, act.band, act.weight, act.target);
        }
    }

    fn prepare(&self, action: Fake, target: Target, ctx: &PrepCtx<'_>) -> Prepared<Fake, Dir> {
        match self.act(action, target).answer {
            Answer::Instead(next) => Prepared::Instead {
                action: next,
                target: Target::None,
            },
            Answer::FailBefore(at, _) if ctx.now() < at => Prepared::Fail,
            Answer::Go(dir) | Answer::FailBefore(_, dir) => match ctx.check_step(dir) {
                Ok(_) => Prepared::Go {
                    cost: Cost::new(100),
                    plan: dir,
                },
                Err(_) => Prepared::Blocked,
            },
            Answer::Fail => Prepared::Fail,
        }
    }

    fn commit(&self, dir: Dir, ctx: &mut CommitCtx<'_>) {
        ctx.step(dir);
    }
}
