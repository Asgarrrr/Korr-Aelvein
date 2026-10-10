use alloc::vec::Vec;

use korr_core::{
    ActionDesc, Band, Candidate, Candidates, CommitCtx, Cost, Mechanics, Pos, PrepCtx, Prepared,
    Senses, Target,
};
use korr_ecs::FloorId;

pub static LEAVE: ActionDesc = ActionDesc::new("leave", "go");

/// Every actor off floor `to` departs for `at` on it.
#[derive(Debug)]
pub struct Leave {
    pub to: FloorId,
    pub at: Pos,
}

impl Mechanics for Leave {
    fn actions(&self, out: &mut Vec<&'static ActionDesc>) {
        out.push(&LEAVE);
    }

    fn perceives(&self) -> bool {
        false
    }

    fn propose(&self, _: &Senses<'_>, out: &mut Candidates) {
        out.push(Candidate {
            action: &LEAVE,
            band: Band::Routine,
            weight: 1,
            target: Target::None,
        });
    }

    fn prepare(&self, _: &'static ActionDesc, _: Target, ctx: &PrepCtx<'_>) -> Prepared {
        if ctx.floor() == self.to {
            Prepared::Fail
        } else {
            Prepared::Go {
                cost: Cost::new(100),
            }
        }
    }

    fn commit(&self, _: &'static ActionDesc, _: Target, ctx: &mut CommitCtx<'_>) {
        ctx.depart(self.to, self.at);
    }
}
