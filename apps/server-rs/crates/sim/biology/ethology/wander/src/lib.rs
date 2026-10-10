//! Wander: a creature with nothing better to do steps in a random direction.
#![no_std]
#![deny(clippy::float_arithmetic)]

mod config;

use core::num::NonZeroU32;

use korr_core::{
    Action, Band, CommitCtx, Dir, DrawIndex, Module, PrepCtx, Prepared, Proposals, Senses, Target,
};

pub use config::{ROAM_COST, ROAM_WEIGHT};

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

impl Module for Wander {
    const NAME: &'static str = "wander";
    type Action = WanderAction;

    fn propose(&self, _: &Senses<'_>, out: &mut Proposals<'_, WanderAction>) {
        out.push(WanderAction::Roam, Band::Routine, ROAM_WEIGHT, Target::None);
    }

    fn prepare(&self, _: WanderAction, _: Target, ctx: &PrepCtx<'_>) -> Prepared<WanderAction> {
        match ctx.check_step(direction(ctx.below(Draw::Dir, DIRECTIONS))) {
            Ok(_) => Prepared::Go { cost: ROAM_COST },
            Err(_) => Prepared::Blocked,
        }
    }

    fn commit(&self, _: WanderAction, _: Target, ctx: &mut CommitCtx<'_>) {
        ctx.step(direction(ctx.below(Draw::Dir, DIRECTIONS)));
    }
}

fn direction(draw: u32) -> Dir {
    Dir::ALL[draw as usize]
}
