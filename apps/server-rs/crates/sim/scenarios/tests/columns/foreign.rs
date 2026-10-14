use core::convert::Infallible;

use korr_contracts::Graze;
use korr_core::host::{Both, Game, Pos, Then, World, keyed};
use korr_core::mechanic::{
    Action, Ask, Band, Builder, CommitCtx, Cost, Module, PrepCtx, Prepared, Proposals, ReadCells,
    Senses, Target,
};
use korr_ecs::FloorId;
use korr_engine::{Modules, Registry};
use korr_scenarios::{floor, flora_only, game, plants};

use super::{Bog, SEED};

/// A ruleset whose first cell column is the peat, not the plants.
fn bogged() -> Game<Both<Bog, Modules>> {
    game(Then(keyed(Bog::build), Registry::default()), SEED)
}

#[test]
#[should_panic(expected = "cell column key from another ruleset")]
fn a_cell_key_of_another_ruleset_reads_no_cell() {
    let foreign = bogged();
    let game = flora_only(SEED);
    let f = floor(game.ruleset(), FloorId(0), 4, 4);
    let _ = f.cell(
        game.ruleset(),
        foreign.mechanics().0.peat,
        Pos { x: 1, y: 1 },
    );
}

#[test]
#[should_panic(expected = "cell column key from another ruleset")]
fn a_cell_key_of_another_ruleset_writes_no_cell() {
    let foreign = bogged();
    let game = flora_only(SEED);
    let mut f = floor(game.ruleset(), FloorId(0), 4, 4);
    f.set_cell(
        game.ruleset(),
        foreign.mechanics().0.peat,
        Pos { x: 1, y: 1 },
        1,
    );
}

/// Reads every cell in sight through `cells`.
struct Peeker {
    cells: ReadCells,
}

impl Module for Peeker {
    const NAME: &'static str = "test.peeker";
    type Action = Infallible;
    type Plan = Infallible;

    fn propose(&self, senses: &Senses<'_>, _: &mut Proposals<'_, Infallible>) {
        let _ = senses.cells(self.cells).count();
    }

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

#[test]
#[cfg(debug_assertions)]
#[should_panic(expected = "cell column key from another ruleset")]
fn senses_read_no_cell_through_a_key_of_another_ruleset() {
    let foreign = flora_only(SEED);
    let game = game(
        Then(
            keyed(Bog::build),
            Peeker {
                cells: plants(foreign.mechanics()),
            },
        ),
        SEED,
    );
    let mut f = floor(game.ruleset(), FloorId(0), 4, 4);
    f.spawn_actor(game.ruleset(), Pos { x: 1, y: 1 });
    game.run_round(&mut World::new(vec![f]));
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Probe {
    Check,
    Order,
}

impl Action for Probe {
    const ALL: &'static [Self] = &[Self::Check, Self::Order];

    fn name(self) -> &'static str {
        match self {
            Self::Check => "check",
            Self::Order => "order",
        }
    }
}

/// Sends `ask` at one cell: `probe` picks whether the prepare only checks
/// it, or the commit orders it unchecked.
struct Prober {
    ask: Ask<Graze>,
    probe: Probe,
}

impl Prober {
    fn build(b: &mut Builder<'_>) -> Self {
        Self {
            ask: b.request::<Graze>().expect("flora serves graze"),
            probe: Probe::Check,
        }
    }
}

impl Module for Prober {
    const NAME: &'static str = "test.prober";
    type Action = Probe;
    type Plan = Pos;

    fn propose(&self, _: &Senses<'_>, out: &mut Proposals<'_, Probe>) {
        out.push(self.probe, Band::Routine, 0, Target::None);
    }

    fn prepare(&self, probe: Probe, _: Target, ctx: &PrepCtx<'_>) -> Prepared<Probe, Pos> {
        let at = Pos { x: 1, y: 1 };
        match probe {
            Probe::Check => {
                let _ = ctx.check(self.ask, at);
                Prepared::Blocked
            }
            Probe::Order => Prepared::Go {
                cost: Cost::new(100),
                plan: at,
            },
        }
    }

    fn commit(&self, at: Pos, ctx: &mut CommitCtx<'_>) {
        ctx.order(self.ask, at);
    }
}

/// An ask built where the plants are the first column, run where the peat is.
fn foreign_ask(probe: Probe) -> Game<Both<Both<Bog, Modules>, Prober>> {
    let foreign = game(Then(flora_registry(), keyed(Prober::build)), SEED);
    let ask = foreign.mechanics().1.ask;
    game(
        Then(
            Then(keyed(Bog::build), flora_registry()),
            Prober { ask, probe },
        ),
        SEED,
    )
}

fn run_foreign_ask(probe: Probe) {
    let game = foreign_ask(probe);
    let mut f = floor(game.ruleset(), FloorId(0), 4, 4);
    f.spawn_actor(game.ruleset(), Pos { x: 1, y: 1 });
    game.run_round(&mut World::new(vec![f]));
}

#[test]
#[cfg(debug_assertions)]
#[should_panic(expected = "request from another ruleset")]
fn a_check_through_an_ask_of_another_ruleset_reads_no_cell() {
    run_foreign_ask(Probe::Check);
}

#[test]
#[should_panic(expected = "request from another ruleset")]
fn an_order_through_an_ask_of_another_ruleset_writes_no_cell() {
    run_foreign_ask(Probe::Order);
}

fn flora_registry() -> Registry {
    Registry {
        wander: false,
        hunger: false,
        ..Registry::default()
    }
}
