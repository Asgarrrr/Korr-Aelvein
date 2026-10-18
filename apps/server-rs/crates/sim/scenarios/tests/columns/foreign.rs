use core::convert::Infallible;
#[expect(
    clippy::disallowed_types,
    reason = "a test fixture, not engine state: it keeps a token to misuse it"
)]
use std::sync::Mutex;

use korr_contracts::Graze;
use korr_core::host::{Both, Game, Pos, Then, World, keyed};
use korr_core::mechanic::{
    Action, Ask, Band, Builder, Checked, CommitCtx, Cost, Module, PrepCtx, Prepared, Proposals,
    ReadCells, Senses, Target,
};
use korr_ecs::FloorId;
use korr_engine::{Modules, Registry};
use korr_scenarios::{floor, flora_only, game, plants};

use super::{Bog, SEED, flora_registry};

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
    Keep,
    Order,
}

impl Action for Probe {
    const ALL: &'static [Self] = &[Self::Check, Self::Keep, Self::Order];

    fn name(self) -> &'static str {
        match self {
            Self::Check => "check",
            Self::Keep => "keep",
            Self::Order => "order",
        }
    }
}

const AT: Pos = Pos { x: 1, y: 1 };

/// Sends `ask` at `AT`: `probe` picks whether the prepare only checks it,
/// whether the commit keeps the checked token, or orders the kept one.
#[expect(
    clippy::disallowed_types,
    reason = "a test fixture, not engine state: it keeps a token to misuse it"
)]
struct Prober {
    ask: Ask<Graze>,
    probe: Probe,
    kept: Mutex<Option<Checked<Graze>>>,
}

impl Prober {
    #[expect(
        clippy::disallowed_types,
        reason = "a test fixture, not engine state: it keeps a token to misuse it"
    )]
    fn build(b: &mut Builder<'_>) -> Self {
        Self {
            ask: b.request::<Graze>().expect("flora serves graze"),
            probe: Probe::Keep,
            kept: Mutex::default(),
        }
    }
}

impl Module for Prober {
    const NAME: &'static str = "test.prober";
    type Action = Probe;
    type Plan = Checked<Graze>;

    fn propose(&self, _: &Senses<'_>, out: &mut Proposals<'_, Probe>) {
        out.push(self.probe, Band::Routine, 0, Target::None);
    }

    fn prepare(
        &self,
        probe: Probe,
        _: Target,
        ctx: &PrepCtx<'_>,
    ) -> Prepared<Probe, Checked<Graze>> {
        let checked = match probe {
            Probe::Check => {
                let _ = ctx.check(self.ask, AT);
                return Prepared::Blocked;
            }
            Probe::Keep => ctx.check(self.ask, AT),
            Probe::Order => self.kept.lock().expect("no probe panics").take(),
        };
        checked.map_or(Prepared::Fail, |plan| Prepared::Go {
            cost: Cost::new(100),
            plan,
        })
    }

    fn commit(&self, checked: Checked<Graze>, ctx: &mut CommitCtx<'_>) {
        match self.probe {
            Probe::Keep => *self.kept.lock().expect("no probe panics") = Some(checked),
            Probe::Check | Probe::Order => ctx.order(checked),
        }
    }
}

/// A token checked and kept where the plants are the first column, run
/// where the peat is.
#[expect(
    clippy::disallowed_types,
    reason = "a test fixture, not engine state: it keeps a token to misuse it"
)]
fn foreign_ask(probe: Probe) -> Game<Both<Both<Bog, Modules>, Prober>> {
    let foreign = game(Then(flora_registry(), keyed(Prober::build)), SEED);
    let ruleset = foreign.ruleset();
    let mut f = floor(ruleset, FloorId(0), 4, 4);
    f.set_cell(ruleset, plants(&foreign.mechanics().0), AT, 1);
    f.spawn_actor(ruleset, AT);
    foreign.run_round(&mut World::new(vec![f]));
    let prober = &foreign.mechanics().1;
    let kept = prober.kept.lock().expect("no probe panics").take();
    assert!(kept.is_some(), "the foreign prober kept its check");
    game(
        Then(
            Then(keyed(Bog::build), flora_registry()),
            Prober {
                ask: prober.ask,
                probe,
                kept: Mutex::new(kept),
            },
        ),
        SEED,
    )
}

fn run_foreign_ask(probe: Probe) {
    let game = foreign_ask(probe);
    let mut f = floor(game.ruleset(), FloorId(0), 4, 4);
    f.spawn_actor(game.ruleset(), AT);
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
fn an_order_through_a_token_of_another_ruleset_writes_no_cell() {
    run_foreign_ask(Probe::Order);
}
