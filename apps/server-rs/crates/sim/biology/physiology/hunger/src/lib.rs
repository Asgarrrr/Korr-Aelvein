//! Hunger: satiety decays every round and sets how urgently a creature needs to
//! eat. A hungry creature steps toward the nearest food of its diet it sees,
//! a plant it grazes or remains it feeds on.
#![no_std]
#![deny(clippy::float_arithmetic)]

extern crate alloc;

pub mod config;

use alloc::vec;
use alloc::vec::Vec;
use core::cmp::Reverse;

use korr_contracts::{Graze, Plants};
use korr_core::mechanic::{
    Action, AnyRead, Ask, Band, Builder, CommitCtx, Component, Dir, EntityId, ImageError, Module,
    Own, Pos, PrepCtx, Prepared, Proposals, Read, ReadCells, Reader, Rows, Senses, Target, Writer,
};

use config::{
    APPROACH_COST, BITE, DECAY, EAT_COST, FULL, PECKISH, PLANT_NUTRITION, REMAINS_NUTRITION,
    STARVE_DAMAGE, STARVING,
};

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

/// What a creature eats: a set of foods.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Diet(u8);

impl Diet {
    pub const PLANTS: Self = Self(1);
    pub const REMAINS: Self = Self(2);
    pub const ALL: Self = Self(Self::PLANTS.0 | Self::REMAINS.0);

    #[must_use]
    pub const fn contains(self, food: Self) -> bool {
        self.0 & food.0 == food.0
    }
}

impl Component for Diet {
    const VERSION: u16 = 0;

    fn write(&self, w: &mut Writer) {
        w.write_u8(self.0);
    }

    fn read(r: &mut Reader<'_>) -> Result<Self, ImageError> {
        let bits = r.read_u8()?;
        if bits & !Self::ALL.0 != 0 {
            return Err(ImageError::Corrupt("diet"));
        }
        Ok(Self(bits))
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
    Feed { id: EntityId },
    Step(Dir),
}

#[derive(Debug)]
pub struct Hunger {
    satiety: Own<Satiety>,
    diet: Own<Diet>,
    plants: Option<ReadCells>,
    graze: Option<Ask<Graze>>,
}

impl Hunger {
    pub fn build(b: &mut Builder<'_>) -> Self {
        Self {
            satiety: b.own("satiety"),
            diet: b.own("diet"),
            plants: b.contract_cells::<Plants>(),
            graze: b.request(),
        }
    }

    #[must_use]
    pub fn satiety(&self) -> Read<Satiety> {
        self.satiety.read()
    }

    #[must_use]
    pub fn diet(&self) -> Read<Diet> {
        self.diet.read()
    }
}

/// 0 at or above `PECKISH`, rising to 255 at empty; rounded up, so any
/// satiety below `PECKISH` is urgent.
fn urgency(satiety: u16) -> u8 {
    let missing = u32::from(PECKISH.saturating_sub(satiety));
    u8::try_from((missing * 255).div_ceil(u32::from(PECKISH))).expect("urgency fits u8")
}

/// The least is eaten first: nearest, then most nourishing, then by (y, x),
/// then a plant (no id) before remains, then by id.
type Choice = (u16, Reverse<u16>, i16, i16, Option<EntityId>);

fn choice(from: Pos, at: Pos, nutrition: u16, remains: Option<EntityId>) -> Choice {
    (from.chebyshev(at), Reverse(nutrition), at.y, at.x, remains)
}

/// A greedy step from `pos` toward `at`.
fn approach(ctx: &PrepCtx<'_>, pos: Pos, at: Pos) -> Prepared<Eating, Meal> {
    let toward = ((at.x - pos.x).signum(), (at.y - pos.y).signum());
    match Dir::ALL.into_iter().find(|dir| dir.offset() == toward) {
        Some(dir) if ctx.check_step(dir).is_ok() => Prepared::Go {
            cost: APPROACH_COST,
            plan: Meal::Step(dir),
        },
        _ => Prepared::Fail,
    }
}

impl Hunger {
    /// Out of line: inlined, the search grows the turn loop every actor runs,
    /// sated or not.
    #[inline(never)]
    fn seek(
        &self,
        senses: &Senses<'_>,
        satiety: u16,
        urgency: u8,
        out: &mut Proposals<'_, Eating>,
    ) {
        let Some(&diet) = senses.get(self.diet.read()) else {
            return;
        };
        let pos = senses.pos();
        let plant = match (self.plants, self.graze) {
            (Some(plants), Some(_)) if diet.contains(Diet::PLANTS) => senses
                .cells(plants)
                .filter(|&(_, growth)| growth > 0)
                .map(|(at, growth)| choice(pos, at, u16::from(growth) * PLANT_NUTRITION, None))
                .min(),
            _ => None,
        };
        let remains = diet
            .contains(Diet::REMAINS)
            .then(|| {
                senses
                    .remains()
                    .map(|r| choice(pos, r.pos, r.mass.min(BITE) * REMAINS_NUTRITION, Some(r.id)))
                    .min()
            })
            .flatten();
        let Some((.., y, x, remains)) = plant.into_iter().chain(remains).min() else {
            return;
        };
        let target = remains.map_or(Target::Pos(Pos { x, y }), Target::Entity);
        let band = if satiety < STARVING {
            Band::Vigilance
        } else {
            Band::Routine
        };
        out.push(Eating::Eat, band, u16::from(urgency), target);
    }
}

impl Module for Hunger {
    const NAME: &'static str = "hunger";
    type Action = Eating;
    type Plan = Meal;

    fn tick_rows(&self, rows: &mut Rows<'_>) {
        // A creature without a diet does not hunger.
        rows.join(&self.satiety, &self.diet, |satiety, _| {
            satiety.0 = satiety.0.saturating_sub(DECAY);
            if satiety.0 == 0 { STARVE_DAMAGE } else { 0 }
        });
    }

    fn requires(&self, _: Eating) -> Vec<AnyRead> {
        vec![self.satiety.read().into(), self.diet.read().into()]
    }

    fn propose(&self, senses: &Senses<'_>, out: &mut Proposals<'_, Eating>) {
        let Some(&Satiety(satiety)) = senses.get(self.satiety.read()) else {
            return;
        };
        let urgency = urgency(satiety);
        if urgency == 0 {
            return;
        }
        self.seek(senses, satiety, urgency, out);
    }

    fn prepare(&self, action: Eating, target: Target, ctx: &PrepCtx<'_>) -> Prepared<Eating, Meal> {
        match target {
            Target::Pos(at) => self.graze_at(action, at, ctx),
            Target::Entity(id) => feed_on(action, id, ctx),
            Target::None => Prepared::Fail,
        }
    }

    fn commit(&self, meal: Meal, ctx: &mut CommitCtx<'_>) {
        match meal {
            Meal::Graze { at, gain } => {
                ctx.order(self.graze.expect("a graze was checked"), at);
                self.sate(gain, ctx);
            }
            Meal::Feed { id } => {
                let eaten = ctx.consume(id, BITE);
                self.sate(eaten * REMAINS_NUTRITION, ctx);
            }
            Meal::Step(dir) => {
                ctx.step(dir);
            }
        }
    }
}

impl Hunger {
    fn graze_at(&self, action: Eating, at: Pos, ctx: &PrepCtx<'_>) -> Prepared<Eating, Meal> {
        let Some(growth) = self.graze.and_then(|graze| ctx.check(graze, at)) else {
            return Prepared::Fail;
        };
        let pos = ctx.pos();
        match action {
            Eating::Eat if pos.chebyshev(at) > 1 => Prepared::Instead {
                action: Eating::Approach,
                target: Target::Pos(at),
            },
            Eating::Eat => Prepared::Go {
                cost: EAT_COST,
                plan: Meal::Graze {
                    at,
                    gain: u16::from(growth) * PLANT_NUTRITION,
                },
            },
            Eating::Approach => approach(ctx, pos, at),
        }
    }

    fn sate(&self, gain: u16, ctx: &mut CommitCtx<'_>) {
        let satiety = ctx
            .get_mut(&self.satiety)
            .expect("the run requires satiety");
        satiety.0 = satiety.0.saturating_add(gain).min(FULL);
    }
}

fn feed_on(action: Eating, id: EntityId, ctx: &PrepCtx<'_>) -> Prepared<Eating, Meal> {
    let pos = ctx.pos();
    match (action, ctx.locate(id)) {
        (Eating::Eat, Some(at)) if pos.chebyshev(at) > 1 => Prepared::Instead {
            action: Eating::Approach,
            target: Target::Entity(id),
        },
        (Eating::Eat, Some(_)) => Prepared::Go {
            cost: EAT_COST,
            plan: Meal::Feed { id },
        },
        (Eating::Approach, Some(at)) => approach(ctx, pos, at),
        (_, None) => Prepared::Fail,
    }
}
