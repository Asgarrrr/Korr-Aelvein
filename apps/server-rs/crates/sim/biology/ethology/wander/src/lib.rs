//! Wander: a creature with nothing better to do steps in a random direction.
#![no_std]
#![deny(clippy::float_arithmetic)]

mod config;

use core::num::NonZeroU32;

use korr_core::{ActionDesc, Candidates, CommitCtx, Dir, PrepCtx, Prepared};

pub use config::ROAM_COST;

pub const NAME: &str = "wander";
pub static ROAM: ActionDesc = ActionDesc::new(NAME, "roam");

/// Permanent: changing it changes every roam.
const DIR_DRAW: u32 = 0;
const DIRECTIONS: NonZeroU32 = NonZeroU32::new(8).expect("Dir::ALL holds eight directions");

#[derive(Debug, Default, Clone, Copy)]
pub struct Wander;

impl Wander {
    pub fn propose(&self, out: &mut Candidates) {
        out.push(&ROAM);
    }

    #[must_use]
    pub fn prepare(&self, ctx: &PrepCtx<'_>) -> Prepared {
        match ctx.check_step(direction(ctx.below(DIR_DRAW, DIRECTIONS))) {
            Ok(_) => Prepared::Go { cost: ROAM_COST },
            Err(_) => Prepared::Blocked,
        }
    }

    pub fn commit(&self, ctx: &mut CommitCtx<'_>) {
        ctx.step(direction(ctx.below(DIR_DRAW, DIRECTIONS)));
    }
}

fn direction(draw: u32) -> Dir {
    Dir::ALL[draw as usize]
}
