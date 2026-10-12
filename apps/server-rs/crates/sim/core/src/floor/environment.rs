use alloc::vec::Vec;
use core::mem;

use korr_ecs::{FloorId, Handle, Store};
use korr_grid::{CellColumn, Grid};
use korr_random::{Phase, Seed, Stream};

use crate::ctx::Draws;
use crate::floor::Floor;
use crate::life::Harm;
use crate::module::{Mechanics, Module, Visit, module_key};
use crate::rows::Rows;
use crate::ruleset::Ruleset;
use crate::time::{Round, Tick};

impl Floor {
    /// Phase 1 of a round: every module that binds a cell column ticks each of
    /// its cells, then every module ticks its entity rows, then remains rot.
    /// The harms land once, after all of it, so registry order never picks
    /// the cause of a death.
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
        self.events.clear();
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
            harms: &mut self.harms,
            harmed: &mut self.harmed,
            ordinal: 0,
        });
        self.rot(ruleset);
        self.drain(ruleset);
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
    harms: &'a mut Vec<Harm>,
    harmed: &'a mut Vec<(Handle, u16)>,
    ordinal: usize,
}

impl Visit for TickVisit<'_> {
    fn module<M: Module>(&mut self, module: &M) {
        if let Some(column) = self.ruleset.modules[self.ordinal].column {
            let time = Tick::start_of(self.round).0;
            let stream = Stream::new(self.seed, module_key::<M>(), Phase::Tick, time);
            let column = &mut self.columns[column.index()];
            let scratch = self
                .scratch
                .as_deref_mut()
                .expect("a ruleset with a cell column gives every floor a scratch");
            self.grid.stencil(column, scratch, |cell| {
                module.tick(cell, Draws::cell(stream, self.floor, cell.pos()))
            });
            mem::swap(column, scratch);
        }
        module.tick_rows(&mut Rows::new(
            self.store,
            self.harms,
            self.harmed,
            module_key::<M>(),
        ));
        self.ordinal += 1;
    }
}
