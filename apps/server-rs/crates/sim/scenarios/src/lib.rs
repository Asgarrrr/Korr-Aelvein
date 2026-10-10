//! Fixtures for the engine scenario tests.
#![no_std]
#![deny(clippy::float_arithmetic)]

use korr_core::{
    ActionDesc, Candidates, CommitCtx, Cost, Dir, Floor, Mechanics, PrepCtx, Prepared,
};
use korr_ecs::{FloorId, SchemaBuilder};
use korr_grid::Shape;

/// A floor over an empty schema.
///
/// # Panics
/// When a side is outside the bounds of `Shape::new`.
#[must_use]
pub fn floor(id: u16, width: u16, height: u16) -> Floor {
    let shape = Shape::new(width, height).expect("scenario shapes fit the bounds");
    Floor::new(&SchemaBuilder::default().build(), FloorId(id), shape)
}

static STEP: ActionDesc = ActionDesc::new("pace", "step");

/// Every actor steps east each turn: 30 ticks for an even id, 100 for an odd one.
#[derive(Debug)]
pub struct Pace;

impl Mechanics for Pace {
    fn propose(&self, out: &mut Candidates) {
        out.push(&STEP);
    }

    fn prepare(&self, _: &'static ActionDesc, ctx: &PrepCtx<'_>) -> Prepared {
        match ctx.check_step(Dir::East) {
            Ok(_) if ctx.actor().to_bits() % 2 == 0 => Prepared::Go {
                cost: Cost::new(30),
            },
            Ok(_) => Prepared::Go {
                cost: Cost::new(100),
            },
            Err(_) => Prepared::Blocked,
        }
    }

    fn commit(&self, _: &'static ActionDesc, ctx: &mut CommitCtx<'_>) {
        ctx.step(Dir::East);
    }
}
