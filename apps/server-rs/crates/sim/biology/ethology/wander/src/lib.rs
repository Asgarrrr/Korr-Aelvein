//! Wander: a creature with nothing better to do steps in a random direction.
#![no_std]
#![deny(clippy::float_arithmetic)]

mod config;

use core::num::NonZeroU32;

use korr_core::mechanic::{
    Action, Band, Builder, CommitCtx, Dir, DrawIndex, Module, PrepCtx, Prepared, Proposals, Senses,
    Target,
};

use config::{ROAM_COST, ROAM_WEIGHT};

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

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WanderAction {
    Roam,
}

impl Action for WanderAction {
    const ALL: &'static [Self] = &[Self::Roam];

    fn name(self) -> &'static str {
        match self {
            Self::Roam => "roam",
        }
    }
}

#[derive(Debug, Default, Clone, Copy)]
pub struct Wander;

impl Wander {
    #[must_use]
    pub fn build(_: &mut Builder<'_>) -> Self {
        Self
    }
}

impl Module for Wander {
    const NAME: &'static str = "wander";
    type Action = WanderAction;
    type Plan = Dir;

    fn propose(&self, _: &Senses<'_>, out: &mut Proposals<'_, WanderAction>) {
        out.push(WanderAction::Roam, Band::Routine, ROAM_WEIGHT, Target::None);
    }

    // Without the hint, one more module in the registry tips LTO into an
    // out-of-line call here: +15-20% per round on the wander benches.
    #[inline]
    fn prepare(
        &self,
        _: WanderAction,
        _: Target,
        ctx: &PrepCtx<'_>,
    ) -> Prepared<WanderAction, Dir> {
        let dir = Dir::ALL[ctx.below(Draw::Dir, DIRECTIONS) as usize];
        match ctx.check_step(dir) {
            Ok(_) => Prepared::Go {
                cost: ROAM_COST,
                plan: dir,
            },
            Err(_) => Prepared::Blocked,
        }
    }

    fn commit(&self, dir: Dir, ctx: &mut CommitCtx<'_>) {
        ctx.step(dir);
    }
}
