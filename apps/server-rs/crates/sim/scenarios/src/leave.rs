use korr_core::{
    Action, Band, CommitCtx, Cost, Module, Pos, PrepCtx, Prepared, Proposals, Senses, Target,
};
use korr_ecs::FloorId;

/// Every actor off floor `to` departs for `at` on it.
#[derive(Debug)]
pub struct Leave {
    pub to: FloorId,
    pub at: Pos,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Go {
    Go,
}

impl Action for Go {
    const ALL: &'static [Self] = &[Self::Go];

    fn name(self) -> &'static str {
        "go"
    }
}

impl Module for Leave {
    const NAME: &'static str = "leave";
    type Action = Go;
    type Plan = ();

    fn propose(&self, _: &Senses<'_>, out: &mut Proposals<'_, Go>) {
        out.push(Go::Go, Band::Routine, 1, Target::None);
    }

    fn prepare(&self, _: Go, _: Target, ctx: &PrepCtx<'_>) -> Prepared<Go, ()> {
        if ctx.floor() == self.to {
            Prepared::Fail
        } else {
            Prepared::Go {
                cost: Cost::new(100),
                plan: (),
            }
        }
    }

    fn commit(&self, (): (), ctx: &mut CommitCtx<'_>) {
        ctx.depart(self.to, self.at);
    }
}
