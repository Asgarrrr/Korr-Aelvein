use core::mem;

use korr_ecs::{FloorId, Store};
use korr_grid::{CellColumn, Grid};
use korr_random::{Phase, Seed, Stream};

use crate::ctx::Draws;
use crate::floor::Floor;
use crate::module::{Mechanics, Module, Visit, module_key};
use crate::rows::Rows;
use crate::ruleset::Ruleset;
use crate::time::{Round, Tick};

impl Floor {
    /// Phase 1 of a round: every module that binds a cell column ticks each of
    /// its cells, then every module ticks its entity rows.
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
        let floor = self.id();
        mechanics.each(&mut TickVisit {
            seed,
            ruleset,
            floor,
            round: self.round,
            grid: &self.grid,
            columns: &mut self.columns,
            scratch: self.scratch.as_mut(),
            store: &mut self.store,
            ordinal: 0,
        });
    }
}

/// Hands each module that binds a cell column that column, then each module
/// the floor's rows.
struct TickVisit<'a> {
    seed: Seed,
    ruleset: &'a Ruleset,
    floor: FloorId,
    round: Round,
    grid: &'a Grid,
    columns: &'a mut [CellColumn],
    /// `None` when the ruleset has no cell column.
    scratch: Option<&'a mut CellColumn>,
    store: &'a mut Store,
    ordinal: usize,
}

impl Visit for TickVisit<'_> {
    fn module<M: Module>(&mut self, module: &M) {
        if let Some(slot) = self.ruleset.modules[self.ordinal].column {
            let time = Tick::start_of(self.round).0;
            let stream = Stream::new(self.seed, module_key::<M>(), Phase::Tick, time);
            let column = &mut self.columns[usize::from(slot)];
            let scratch = self
                .scratch
                .as_deref_mut()
                .expect("a ruleset with a cell column gives every floor a scratch");
            self.grid.stencil(column, scratch, |cell| {
                module.tick(cell, Draws::cell(stream, self.floor, cell.pos()))
            });
            mem::swap(column, scratch);
        }
        module.tick_rows(&mut Rows::new(self.store));
        self.ordinal += 1;
    }
}
