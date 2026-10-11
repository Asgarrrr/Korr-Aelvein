use core::mem;

use korr_ecs::FloorId;
use korr_grid::{CellColumn, Grid};
use korr_random::{Phase, Seed, Stream};

use crate::ctx::Draws;
use crate::floor::Floor;
use crate::module::{Mechanics, Module, Visit, module_key};
use crate::ruleset::Ruleset;
use crate::time::{Round, Tick};

impl Floor {
    /// Phase 1 of a round: every module that owns a cell column ticks each of its cells.
    ///
    /// # Panics
    /// When `ruleset` is not the one that built this floor.
    pub(crate) fn run_environment(
        &mut self,
        seed: Seed,
        ruleset: &Ruleset,
        mechanics: &impl Mechanics,
    ) {
        self.check_ruleset(ruleset);
        mechanics.each(&mut TickVisit {
            seed,
            ruleset,
            floor: self.id(),
            round: self.round,
            grid: &self.grid,
            columns: &mut self.columns,
            scratch: &mut self.scratch,
            slot: 0,
        });
    }
}

/// Hands each module with a cell column its own column, in `Ruleset::columns` order.
struct TickVisit<'a> {
    seed: Seed,
    ruleset: &'a Ruleset,
    floor: FloorId,
    round: Round,
    grid: &'a Grid,
    columns: &'a mut [CellColumn],
    scratch: &'a mut CellColumn,
    slot: usize,
}

impl Visit for TickVisit<'_> {
    fn module<M: Module>(&mut self, module: &M) {
        if M::CELL_COLUMN {
            debug_assert_eq!(self.ruleset.columns[self.slot], M::NAME);
            let time = Tick::start_of(self.round).0;
            let stream = Stream::new(self.seed, module_key::<M>(), Phase::Tick, time);
            let column = &mut self.columns[self.slot];
            self.grid.stencil(column, self.scratch, |cell| {
                module.tick(cell, Draws::cell(stream, self.floor, cell.index()))
            });
            mem::swap(column, self.scratch);
            self.slot += 1;
        }
    }
}
