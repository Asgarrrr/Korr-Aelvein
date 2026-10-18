use korr_core::mechanic::{
    Band, CommitCtx, Cost, Module, Pos, PrepCtx, Prepared, Proposals, Senses, Target,
};
use korr_ecs::FloorId;

use crate::leave::Go;

/// Every actor departs for `at` on the next floor of `0..floors`, the last floor's for floor 0.
#[derive(Debug)]
pub struct Ring {
    pub floors: u16,
    pub at: Pos,
}

impl Module for Ring {
    const NAME: &'static str = "ring";
    type Action = Go;
    type Plan = FloorId;

    fn propose(&self, _: &Senses<'_>, out: &mut Proposals<'_, Go>) {
        out.push(Go::Go, Band::Routine, 1, Target::None);
    }

    fn prepare(&self, _: Go, _: Target, ctx: &PrepCtx<'_>) -> Prepared<Go, FloorId> {
        let next = ctx
            .floor()
            .0
            .checked_add(1)
            .filter(|&n| n < self.floors)
            .unwrap_or(0);
        Prepared::Go {
            cost: Cost::new(100),
            plan: FloorId(next),
        }
    }

    fn commit(&self, to: FloorId, ctx: &mut CommitCtx<'_>) {
        ctx.depart(to, self.at);
    }
}
