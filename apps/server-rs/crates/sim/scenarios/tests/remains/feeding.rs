use korr_core::{host::ROT_PER_ROUND, mechanic::Pos};
use korr_engine::Registry;
use korr_hunger::Diet;
use korr_hunger::config::{BITE, DECAY, PECKISH, REMAINS_NUTRITION};
use korr_scenarios::{game, plants, run};

use super::{CARCASS, FIELD, MASS, SEED, carnivorous, fed_field, field, laid, mass, masses};

#[test]
fn a_carnivore_eats_remains_away() {
    assert_eq!(
        masses(&carnivorous(), Diet::REMAINS, 3),
        [
            Some(MASS - BITE),
            Some(MASS - 2 * BITE - ROT_PER_ROUND),
            None
        ]
    );
}

#[test]
fn a_herbivore_never_feeds_on_remains() {
    assert_eq!(
        masses(&carnivorous(), Diet::PLANTS, 3),
        [
            Some(MASS),
            Some(MASS - ROT_PER_ROUND),
            Some(MASS - 2 * ROT_PER_ROUND)
        ]
    );
}

#[test]
fn without_flora_a_carnivore_still_feeds() {
    let game = game(
        Registry {
            wander: false,
            flora: false,
            ..Registry::default()
        },
        SEED,
    );
    assert_eq!(masses(&game, Diet::REMAINS, 1), [Some(MASS - BITE)]);
}

/// The remains' mass and the plant's growth after round 1, when a starving
/// creature of `diet` lies between the remains and a plant of
/// `growth`, which grows one step before it acts.
fn first_meal(diet: Diet, growth: u8) -> (Option<u16>, u8) {
    let game = carnivorous();
    let plant = Pos { x: 6, y: 4 };
    let mut world = fed_field(
        &game,
        &[(CARCASS, MASS)],
        &[(Pos { x: 5, y: 4 }, 0, diet)],
        &[(plant, growth)],
    )
    .0;
    run(&game, &mut world, 1);
    let [remains] = laid(&world)[..] else {
        panic!("one donor, one remains");
    };
    let growth = world
        .floor(FIELD)
        .cell(game.ruleset(), plants(game.mechanics()), plant);
    (mass(&game, &world, remains), growth)
}

#[test]
fn of_foods_as_near_and_as_nourishing_the_first_in_row_order_is_eaten() {
    assert_eq!(first_meal(Diet::ALL, 1), (Some(MASS - BITE), 2));
}

#[test]
fn a_plant_more_nourishing_than_a_bite_is_eaten_first() {
    assert_eq!(first_meal(Diet::ALL, 2), (Some(MASS), 0));
}

#[test]
fn a_carnivore_never_grazes() {
    assert_eq!(first_meal(Diet::REMAINS, 2), (Some(MASS - BITE), 3));
}

#[test]
fn remains_two_cells_away_are_approached_before_any_bite() {
    let game = carnivorous();
    let eater = (Pos { x: 6, y: 4 }, 0, Diet::REMAINS);
    let (mut world, carnivores) = field(&game, &[(CARCASS, MASS)], &[eater]);
    run(&game, &mut world, 1);
    let [remains] = laid(&world)[..] else {
        panic!("one donor, one remains");
    };
    assert_eq!(mass(&game, &world, remains), Some(MASS));
    assert_eq!(
        world.floor(FIELD).pos(carnivores[0]),
        Some(Pos { x: 5, y: 4 })
    );
}

/// A unit of remains sates by its mass, not by a bite: it leaves the
/// carnivore hungry enough to walk on to the other remains 3 cells away.
#[test]
fn remains_smaller_than_a_bite_sate_by_the_mass_eaten() {
    let game = carnivorous();
    let home = Pos { x: 5, y: 4 };
    let satiety = PECKISH + 2 * DECAY - BITE * REMAINS_NUTRITION / 2;
    let (mut world, carnivores) = field(
        &game,
        &[(CARCASS, 1), (Pos { x: 4, y: 1 }, MASS)],
        &[(home, satiety, Diet::REMAINS)],
    );
    run(&game, &mut world, 2);
    assert_ne!(world.floor(FIELD).pos(carnivores[0]), Some(home));
}

#[test]
fn one_bite_that_sates_ends_the_meal() {
    let game = carnivorous();
    // One bite lifts it to `PECKISH` after the next decay.
    let satiety = PECKISH + 2 * DECAY - BITE * REMAINS_NUTRITION;
    let eater = (Pos { x: 5, y: 4 }, satiety, Diet::REMAINS);
    let (mut world, _) = field(&game, &[(CARCASS, MASS)], &[eater]);
    run(&game, &mut world, 1);
    let [remains] = laid(&world)[..] else {
        panic!("one donor, one remains");
    };
    run(&game, &mut world, 1);
    assert_eq!(
        mass(&game, &world, remains),
        Some(MASS - BITE - ROT_PER_ROUND)
    );
}

/// The last unit of one remains lies between two carnivores, each of which
/// it sates; other remains lie 3 cells from both.
#[test]
fn of_two_carnivores_one_eats_the_last_unit() {
    let game = carnivorous();
    let satiety = PECKISH + 2 * DECAY - REMAINS_NUTRITION;
    let sides = [Pos { x: 3, y: 4 }, Pos { x: 5, y: 4 }];
    let (mut world, carnivores) = field(
        &game,
        &[(CARCASS, 1), (Pos { x: 4, y: 1 }, MASS)],
        &sides.map(|at| (at, satiety, Diet::REMAINS)),
    );
    run(&game, &mut world, 1);
    let [last, far] = laid(&world)[..] else {
        panic!("two donors, two remains");
    };
    assert_eq!(mass(&game, &world, last), None);
    assert_eq!(mass(&game, &world, far), Some(MASS));
    run(&game, &mut world, 1);
    let hungry = carnivores
        .iter()
        .zip(sides)
        .filter(|&(&h, at)| world.floor(FIELD).pos(h) != Some(at))
        .count();
    assert_eq!(hungry, 1, "only the carnivore that did not eat walks on");
}
