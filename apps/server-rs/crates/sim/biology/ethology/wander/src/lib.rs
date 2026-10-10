//! Wander: a creature with nothing better to do steps in a random direction.
#![no_std]
#![deny(clippy::float_arithmetic)]

mod config;

use core::num::NonZeroU32;

use korr_core::{
    ActionDesc, Band, Candidate, Candidates, CommitCtx, Dir, DrawIndex, PrepCtx, Prepared, Senses,
    Target,
};

pub use config::{ROAM_COST, ROAM_WEIGHT};

pub const NAME: &str = "wander";
pub static ROAM: ActionDesc = ActionDesc::new(NAME, "roam");

const DIRECTIONS: NonZeroU32 = NonZeroU32::new(8).expect("Dir::ALL holds eight directions");

/// Permanent indexes: changing one changes every roam.
enum Draw {
    Dir,
}

impl From<Draw> for DrawIndex {
    fn from(draw: Draw) -> Self {
        match draw {
            Draw::Dir => DrawIndex(0),
        }
    }
}

#[derive(Debug, Default, Clone, Copy)]
pub struct Wander;

impl Wander {
    pub fn propose(&self, _: &Senses<'_>, out: &mut Candidates) {
        out.push(Candidate {
            action: &ROAM,
            band: Band::Routine,
            weight: ROAM_WEIGHT,
            target: Target::None,
        });
    }

    #[must_use]
    pub fn prepare(&self, _: Target, ctx: &PrepCtx<'_>) -> Prepared {
        match ctx.check_step(direction(ctx.below(Draw::Dir, DIRECTIONS))) {
            Ok(_) => Prepared::Go { cost: ROAM_COST },
            Err(_) => Prepared::Blocked,
        }
    }

    pub fn commit(&self, _: Target, ctx: &mut CommitCtx<'_>) {
        ctx.step(direction(ctx.below(Draw::Dir, DIRECTIONS)));
    }
}

fn direction(draw: u32) -> Dir {
    Dir::ALL[draw as usize]
}
