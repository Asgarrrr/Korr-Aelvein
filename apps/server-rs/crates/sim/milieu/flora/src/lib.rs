//! Flora: the plants on the cells of a floor. A cell's value is its plant, 0
//! for bare ground. Each round a plant grows one step until ripe, and bare
//! ground beside ripe plants may sprout. A plant off walkable ground withers.
#![no_std]
#![deny(clippy::float_arithmetic)]

mod config;

use core::convert::Infallible;

use korr_core::mechanic::{
    CommitCtx, DrawIndex, Draws, Module, PrepCtx, Prepared, Proposals, Senses, Stencil, Target,
};

use crate::config::{RIPE, SPROUT_CHANCE, SPROUT_ODDS};

/// Permanent indexes: changing one changes every sprout.
enum Draw {
    Sprout,
}

impl From<Draw> for DrawIndex {
    fn from(draw: Draw) -> Self {
        match draw {
            Draw::Sprout => DrawIndex(0),
        }
    }
}

#[derive(Debug, Default, Clone, Copy)]
pub struct Flora;

impl Module for Flora {
    const NAME: &'static str = "flora";
    type Action = Infallible;
    type Plan = Infallible;
    const CELL_COLUMN: bool = true;

    #[inline]
    fn tick(&self, cell: Stencil<'_>, draws: Draws) -> u8 {
        if !cell.walkable() {
            0
        } else if cell.value() != 0 {
            cell.value().saturating_add(1).min(RIPE)
        } else {
            let neighbours = cell.neighbours();
            if neighbours.iter().all(|&n| n < RIPE) {
                return 0;
            }
            // Terrain is read only beside a ripe value: most bare ground has none.
            let ripe = neighbours
                .into_iter()
                .zip(cell.walkable_neighbours())
                .filter(|&(n, ground)| ground && n >= RIPE)
                .count();
            // The chances add up per ripe neighbour, so a lone plant spreads slower than a thicket.
            let ripe = u32::try_from(ripe).expect("a cell has eight neighbours");
            u8::from(draws.below(Draw::Sprout, SPROUT_ODDS) < ripe * SPROUT_CHANCE)
        }
    }

    fn propose(&self, _: &Senses<'_>, _: &mut Proposals<'_, Infallible>) {}

    fn prepare(
        &self,
        action: Infallible,
        _: Target,
        _: &PrepCtx<'_>,
    ) -> Prepared<Infallible, Infallible> {
        match action {}
    }

    fn commit(&self, plan: Infallible, _: &mut CommitCtx<'_>) {
        match plan {}
    }
}
