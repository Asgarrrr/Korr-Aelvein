use core::convert::Infallible;

use korr_contracts::Graze;
use korr_core::host::{Floor, Game, LoadError, Pos, Ruleset, Sections, Seed, Then, World, keyed};
use korr_core::mechanic::{
    Builder, CommitCtx, Module, PrepCtx, Prepared, Proposals, Senses, Served, Target, serves,
};
use korr_ecs::{FloorId, ImageError};
use korr_engine::{Modules, Registry};
use korr_scenarios::{actionless, floor, game, reload};

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

actionless!(Peat, "test.peat", cells);

#[test]
#[should_panic(expected = "ruleset is not the one that built this floor")]
fn a_cell_column_is_not_readable_under_a_foreign_ruleset() {
    let building = game(keyed(Soiled::build), SEED);
    let f = floor(building.ruleset(), FloorId(0), 4, 4);
    let foreign = game(keyed(Peat::build), SEED);
    let _ = f.cell(foreign.ruleset(), "test.peat.cells", Pos { x: 1, y: 1 });
}

#[test]
#[should_panic(expected = "no cell column named test.peat.cells")]
fn a_cell_column_is_found_only_by_its_name() {
    let game = game(keyed(Soiled::build), SEED);
    let f = floor(game.ruleset(), FloorId(0), 4, 4);
    let _ = f.cell(game.ruleset(), "test.peat.cells", Pos { x: 1, y: 1 });
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
fn planted(ruleset: &Ruleset) -> Floor {
    let mut f = floor(ruleset, FloorId(0), 10, 7);
    for (x, y, value) in [(1, 1, 1), (8, 1, 2), (1, 5, 3), (8, 5, 255), (4, 3, 4)] {
        f.set_cell(ruleset, "plants", Pos { x, y }, value);
    }
    f
}

fn flora_only() -> Game<Modules> {
    game(
        Registry {
            wander: false,
            hunger: false,
            ..Registry::default()
        },
        SEED,
    )
}

#[test]
fn planted_cells_survive_a_reload() {
    let game = flora_only();
    let ruleset = game.ruleset();
    let saved = planted(ruleset);
    let loaded = reload(ruleset, &saved);
    for y in 1..=5 {
        for x in 1..=8 {
            let at = Pos { x, y };
            assert_eq!(
                loaded.cell(ruleset, "plants", at),
                saved.cell(ruleset, "plants", at),
                "{at:?}"
            );
        }
    }
}

/// The format is the interior only, one byte per cell, row by row: a walk that
/// is wrong on both the write and the read side still round-trips, so pin the bytes.
#[test]
fn the_column_section_holds_the_interior_row_by_row() {
    let game = flora_only();
    let ruleset = game.ruleset();
    let columns = Sections::parse(&planted(ruleset).save(ruleset))
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
    let game = flora_only();
    let ruleset = game.ruleset();
    let sections = Sections::parse(&planted(ruleset).save(ruleset)).expect("own save parses");
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
