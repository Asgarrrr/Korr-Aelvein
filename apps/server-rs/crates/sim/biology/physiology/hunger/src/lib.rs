//! Hunger: satiety decays every round and sets how urgently a creature needs to
//! eat. A hungry creature steps toward the nearest plant it sees and grazes it.
#![no_std]
#![deny(clippy::float_arithmetic)]

extern crate alloc;

pub mod config;

use alloc::vec;
use alloc::vec::Vec;
use core::cmp::Reverse;

use korr_contracts::{Appetite, Graze, Plants};
use korr_core::mechanic::{
    Action, AnyRead, Ask, Band, Builder, CommitCtx, Component, Dir, ImageError, Module, Own, Pos,
    PrepCtx, Prepared, Proposals, Provided, ReadCells, Reader, Rows, Senses, Target, Writer,
    provides,
};

use config::{APPROACH_COST, DECAY, EAT_COST, FULL, PECKISH, PLANT_NUTRITION, STARVING};

/// What is left in the stomach.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Satiety(pub u16);

impl Component for Satiety {
    const VERSION: u16 = 0;

    fn write(&self, w: &mut Writer) {
        w.write_u16(self.0);
    }

    fn read(r: &mut Reader<'_>) -> Result<Self, ImageError> {
        r.read_u16().map(Self)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Eating {
    Eat,
    Approach,
}

impl Action for Eating {
    const ALL: &'static [Self] = &[Self::Eat, Self::Approach];

    fn name(self) -> &'static str {
        match self {
            Self::Eat => "eat",
            Self::Approach => "approach",
        }
    }
}

#[derive(Debug)]
pub enum Meal {
    Graze { at: Pos, gain: u16 },
    Step(Dir),
}

#[derive(Debug)]
pub struct Hunger {
    satiety: Own<Satiety>,
    appetite: Own<Appetite>,
    plants: Option<ReadCells>,
    graze: Option<Ask<Graze>>,
}

impl Hunger {
    pub fn build(b: &mut Builder<'_>) -> Self {
        Self {
            satiety: b.own("satiety"),
            appetite: b.provide(),
            plants: b.contract_cells::<Plants>(),
            graze: b.command(),
        }
    }
}

/// 0 at or above `PECKISH`, rising to 255 at empty; rounded up, so any
/// satiety below `PECKISH` is urgent.
fn urgency(satiety: u16) -> u8 {
    let missing = u32::from(PECKISH.saturating_sub(satiety));
    u8::try_from((missing * 255).div_ceil(u32::from(PECKISH))).expect("urgency fits u8")
}

fn chebyshev(a: Pos, b: Pos) -> u16 {
    a.x.abs_diff(b.x).max(a.y.abs_diff(b.y))
}

impl Module for Hunger {
    const NAME: &'static str = "hunger";
    const PROVIDES: &'static [Provided] = &[provides::<Appetite>()];
    type Action = Eating;
    type Plan = Meal;

    fn tick_rows(&self, rows: &mut Rows<'_>) {
        rows.join(&self.satiety, &self.appetite, |satiety, appetite| {
            satiety.0 = satiety.0.saturating_sub(DECAY);
            appetite.urgency = urgency(satiety.0);
        });
    }

    fn requires(&self, _: Eating) -> Vec<AnyRead> {
        vec![self.satiety.read().into(), self.appetite.read().into()]
    }

    fn propose(&self, senses: &Senses<'_>, out: &mut Proposals<'_, Eating>) {
        let (Some(plants), Some(_)) = (self.plants, self.graze) else {
            return;
        };
        let Some(&Satiety(satiety)) = senses.get(self.satiety.read()) else {
            return;
        };
        let urgency = urgency(satiety);
        if urgency == 0 {
            return;
        }
        let pos = senses.pos();
        let Some((at, _)) = senses
            .cells(plants)
            .filter(|&(_, growth)| growth > 0)
            .min_by_key(|&(at, growth)| (chebyshev(pos, at), Reverse(growth)))
        else {
            return;
        };
        let band = if satiety < STARVING {
            Band::Vigilance
        } else {
            Band::Routine
        };
        out.push(Eating::Eat, band, u16::from(urgency), Target::Pos(at));
    }

    fn prepare(&self, action: Eating, target: Target, ctx: &PrepCtx<'_>) -> Prepared<Eating, Meal> {
        let (Target::Pos(at), Some(graze)) = (target, self.graze) else {
            return Prepared::Fail;
        };
        let pos = ctx.pos();
        match action {
            Eating::Eat if chebyshev(pos, at) > 1 => Prepared::Instead {
                action: Eating::Approach,
                target,
            },
            Eating::Eat => match ctx.check(graze, at) {
                Some(growth) => Prepared::Go {
                    cost: EAT_COST,
                    plan: Meal::Graze {
                        at,
                        gain: u16::from(growth) * PLANT_NUTRITION,
                    },
                },
                None => Prepared::Fail,
            },
            Eating::Approach => {
                let toward = ((at.x - pos.x).signum(), (at.y - pos.y).signum());
                match Dir::ALL.into_iter().find(|dir| dir.offset() == toward) {
                    Some(dir) if ctx.check_step(dir).is_ok() => Prepared::Go {
                        cost: APPROACH_COST,
                        plan: Meal::Step(dir),
                    },
                    _ => Prepared::Fail,
                }
            }
        }
    }

    fn commit(&self, meal: Meal, ctx: &mut CommitCtx<'_>) {
        match meal {
            Meal::Graze { at, gain } => {
                ctx.order(self.graze.expect("a graze was checked"), at);
                let satiety = ctx
                    .get_mut(&self.satiety)
                    .expect("the run requires satiety");
                satiety.0 = satiety.0.saturating_add(gain).min(FULL);
                let satiety = satiety.0;
                ctx.get_mut(&self.appetite)
                    .expect("the run requires appetite")
                    .urgency = urgency(satiety);
            }
            Meal::Step(dir) => {
                ctx.step(dir);
            }
        }
    }
}
