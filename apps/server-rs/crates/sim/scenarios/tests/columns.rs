use core::convert::Infallible;

use korr_contracts::Graze;
use korr_core::host::{Both, Floor, Game, LoadError, Pos, Sections, Seed, Then, World, keyed};
use korr_core::mechanic::{
    Builder, CellContract, CommitCtx, Module, PrepCtx, Prepared, Proposals, Provided, ReadCells,
    Senses, Served, Target, provides_cells, serves,
};
use korr_ecs::{FloorId, ImageError};
use korr_engine::{Modules, Registry};
use korr_hunger::{Diet, Hunger};
use korr_scenarios::{actionless, floor, flora_only, game, hunger, plants, reload, run, stomach};

const SEED: Seed = Seed(7);

// One name, with and without a cell column.
actionless!(Bare, "test.soil");
actionless!(Soiled, "test.soil", cells);

#[test]
fn a_module_that_gains_a_column_refuses_the_save() {
    let saving = game(Bare, SEED);
    let bytes = floor(saving.ruleset(), FloorId(0), 4, 4).save(saving.ruleset());
    let running = game(keyed(Soiled::build), SEED);
    assert!(matches!(
        Floor::load(running.ruleset(), &bytes),
        Err(LoadError::Ruleset { .. })
    ));
}

#[test]
#[should_panic(expected = "ruleset is not the one that built this floor")]
fn a_cell_column_is_not_readable_under_a_foreign_ruleset() {
    let building = game(keyed(Soiled::build), SEED);
    let f = floor(building.ruleset(), FloorId(0), 4, 4);
    let foreign = flora_only(SEED);
    let _ = f.cell(
        foreign.ruleset(),
        plants(foreign.mechanics()),
        Pos { x: 1, y: 1 },
    );
}

actionless!(Greedy, "test.greedy");

impl Greedy {
    fn build(b: &mut Builder<'_>) -> Self {
        b.cells("soil");
        b.cells("peat");
        Self
    }
}

#[test]
#[should_panic(expected = "test.greedy owns two cell columns")]
fn a_module_binds_one_cell_column() {
    let _ = game(keyed(Greedy::build), SEED);
}

/// Serves `Graze` like flora, on a column of its own or none.
struct Grazed;

impl Grazed {
    fn bare(_: &mut Builder<'_>) -> Self {
        Self
    }

    fn build(b: &mut Builder<'_>) -> Self {
        b.cells("cells");
        Self
    }

    fn asking(b: &mut Builder<'_>) -> Self {
        b.cells("cells");
        let _ = b.request::<Graze>();
        Self
    }
}

impl Module for Grazed {
    const NAME: &'static str = "test.grazed";
    const SERVES: Option<Served> = Some(serves::<Graze>(Some, |value| value));
    type Action = Infallible;
    type Plan = Infallible;

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

#[test]
#[should_panic(expected = "test.grazed serves graze without a cell column")]
fn a_request_is_served_on_a_cell_column() {
    let _ = game(keyed(Grazed::bare), SEED);
}

#[test]
#[should_panic(expected = "hunger asks graze before its server builds")]
fn a_request_is_asked_after_its_server_builds() {
    let _ = game(Then(keyed(Hunger::build), keyed(Grazed::build)), SEED);
}

#[test]
#[should_panic(expected = "test.grazed asks its own request graze")]
fn a_server_does_not_ask_its_own_request() {
    let _ = game(keyed(Grazed::asking), SEED);
}

#[test]
#[should_panic(expected = "request graze served by flora and test.grazed")]
fn one_module_serves_a_request() {
    let _ = game(Then(Registry::default(), keyed(Grazed::build)), SEED);
}

#[test]
#[should_panic(expected = "ruleset is not the one that built this floor")]
fn a_round_does_not_run_on_a_floor_of_another_ruleset() {
    let building = game(
        Registry {
            flora: false,
            ..Registry::default()
        },
        SEED,
    );
    let mut world = World::new(vec![floor(building.ruleset(), FloorId(0), 4, 4)]);
    game(Registry::default(), SEED).run_round(&mut world);
}

#[test]
#[should_panic(expected = "ruleset is not the one that built this floor")]
fn a_floor_is_not_saved_under_another_ruleset() {
    let building = game(Registry::default(), SEED);
    let f = floor(building.ruleset(), FloorId(0), 4, 4);
    let foreign = game(
        Registry {
            flora: false,
            ..Registry::default()
        },
        SEED,
    );
    let _ = f.save(foreign.ruleset());
}

/// Not square: a transposed walk lands on other cells.
fn planted(game: &Game<Modules>) -> Floor {
    let mut f = floor(game.ruleset(), FloorId(0), 10, 7);
    for (x, y, value) in [(1, 1, 1), (8, 1, 2), (1, 5, 3), (8, 5, 255), (4, 3, 4)] {
        f.set_cell(
            game.ruleset(),
            plants(game.mechanics()),
            Pos { x, y },
            value,
        );
    }
    f
}

#[test]
fn planted_cells_survive_a_reload() {
    let game = flora_only(SEED);
    let (ruleset, cells) = (game.ruleset(), plants(game.mechanics()));
    let saved = planted(&game);
    let loaded = reload(ruleset, &saved);
    for y in 1..=5 {
        for x in 1..=8 {
            let at = Pos { x, y };
            assert_eq!(
                loaded.cell(ruleset, cells, at),
                saved.cell(ruleset, cells, at),
                "{at:?}"
            );
        }
    }
}

/// The format is the interior only, one byte per cell, row by row: a walk that
/// is wrong on both the write and the read side still round-trips, so pin the bytes.
#[test]
fn the_column_section_holds_the_interior_row_by_row() {
    let game = flora_only(SEED);
    let ruleset = game.ruleset();
    let columns = Sections::parse(&planted(&game).save(ruleset))
        .expect("own save parses")
        .columns;
    // 8 x 5 interior cells; (x, y) sits at (y - 1) * 8 + (x - 1).
    assert_eq!(columns.len(), 40);
    for (offset, value) in [(0, 1), (7, 2), (32, 3), (39, 255), (19, 4)] {
        assert_eq!(columns[offset], value, "offset {offset}");
    }
    assert_eq!(columns.iter().filter(|&&b| b != 0).count(), 5);
}

#[test]
fn a_cut_or_padded_column_section_is_refused() {
    let game = flora_only(SEED);
    let ruleset = game.ruleset();
    let sections = Sections::parse(&planted(&game).save(ruleset)).expect("own save parses");
    let mut cut = sections.clone();
    cut.columns.pop();
    assert!(matches!(
        Floor::load(ruleset, &cut.seal()),
        Err(LoadError::Image(ImageError::Truncated { .. }))
    ));
    let mut padded = sections;
    padded.columns.push(0);
    assert_eq!(
        Floor::load(ruleset, &padded.seal()).err(),
        Some(LoadError::Image(ImageError::Trailing(1)))
    );
}

struct Peat;

impl CellContract for Peat {
    const NAME: &'static str = "test.peat";
}

/// Provides a cell column, so a module declared before flora puts the
/// plants second.
struct Bog {
    peat: ReadCells,
}

impl Bog {
    fn build(b: &mut Builder<'_>) -> Self {
        Self {
            peat: b.provide_cells::<Peat>(),
        }
    }
}

impl Module for Bog {
    const NAME: &'static str = "test.bog";
    const PROVIDES: &'static [Provided] = &[provides_cells::<Peat>()];
    type Action = Infallible;
    type Plan = Infallible;

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

#[test]
fn a_graze_reaches_the_plants_when_they_are_not_the_first_column() {
    let registry = Registry {
        wander: false,
        ..Registry::default()
    };
    let game = game(Then(keyed(Bog::build), registry), SEED);
    let (ruleset, bog, modules) = (game.ruleset(), &game.mechanics().0, &game.mechanics().1);
    let food = Pos { x: 5, y: 4 };
    let mut f = floor(ruleset, FloorId(0), 9, 9);
    f.set_cell(ruleset, plants(modules), food, 3);
    f.set_cell(ruleset, bog.peat, food, 9);
    let h = f.spawn_actor(ruleset, Pos { x: 4, y: 4 });
    stomach(&mut f, hunger(modules), h, 0, Diet::PLANTS);
    let mut world = World::new(vec![f]);
    run(&game, &mut world, 1);
    let f = world.floor(FloorId(0));
    assert_eq!(f.cell(ruleset, plants(modules), food), 0);
    assert_eq!(f.cell(ruleset, bog.peat, food), 9);
}

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
