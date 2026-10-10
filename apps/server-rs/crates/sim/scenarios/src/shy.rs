use core::num::NonZeroU32;

use korr_core::{
    Action, Band, CommitCtx, Cost, Dir, DrawIndex, Module, PrepCtx, Prepared, Proposals, Senses,
    Target,
};

const DIRECTIONS: NonZeroU32 = NonZeroU32::new(8).expect("Dir::ALL holds eight directions");

/// A creature that steps in a random direction only while it sees another.
#[derive(Debug, Default)]
pub struct Shy;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Startle {
    Startle,
}

impl Action for Startle {
    const ALL: &'static [Self] = &[Self::Startle];

    fn name(self) -> &'static str {
        "startle"
    }
}

impl Module for Shy {
    const NAME: &'static str = "shy";
    type Action = Startle;

    fn perceives(&self) -> bool {
        true
    }

    fn propose(&self, senses: &Senses<'_>, out: &mut Proposals<'_, Startle>) {
        if !senses.seen().is_empty() {
            out.push(Startle::Startle, Band::Routine, 1, Target::None);
        }
    }

    fn prepare(&self, _: Startle, _: Target, ctx: &PrepCtx<'_>) -> Prepared<Startle> {
        match ctx.check_step(Dir::ALL[ctx.below(DrawIndex(0), DIRECTIONS) as usize]) {
            Ok(_) => Prepared::Go {
                cost: Cost::new(100),
            },
            Err(_) => Prepared::Blocked,
        }
    }

    fn commit(&self, _: Startle, _: Target, ctx: &mut CommitCtx<'_>) {
        ctx.step(Dir::ALL[ctx.below(DrawIndex(0), DIRECTIONS) as usize]);
    }
}
