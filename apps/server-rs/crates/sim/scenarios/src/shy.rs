use alloc::vec::Vec;
use core::num::NonZeroU32;

use korr_core::{
    ActionDesc, Band, Candidate, Candidates, CommitCtx, Cost, Dir, DrawIndex, Mechanics, PrepCtx,
    Prepared, Senses, Target,
};

pub static STARTLE: ActionDesc = ActionDesc::new("shy", "startle");

const DIRECTIONS: NonZeroU32 = NonZeroU32::new(8).expect("Dir::ALL holds eight directions");

/// A creature that steps in a random direction only while it sees another.
#[derive(Debug, Default)]
pub struct Shy;

impl Mechanics for Shy {
    fn actions(&self, out: &mut Vec<&'static ActionDesc>) {
        out.push(&STARTLE);
    }

    fn perceives(&self) -> bool {
        true
    }

    fn propose(&self, senses: &Senses<'_>, out: &mut Candidates) {
        if !senses.seen().is_empty() {
            out.push(Candidate {
                action: &STARTLE,
                band: Band::Routine,
                weight: 1,
                target: Target::None,
            });
        }
    }

    fn prepare(&self, _: &'static ActionDesc, _: Target, ctx: &PrepCtx<'_>) -> Prepared {
        match ctx.check_step(Dir::ALL[ctx.below(DrawIndex(0), DIRECTIONS) as usize]) {
            Ok(_) => Prepared::Go {
                cost: Cost::new(100),
            },
            Err(_) => Prepared::Blocked,
        }
    }

    fn commit(&self, _: &'static ActionDesc, _: Target, ctx: &mut CommitCtx<'_>) {
        ctx.step(Dir::ALL[ctx.below(DrawIndex(0), DIRECTIONS) as usize]);
    }
}
