use korr_core::mechanic::{Band, Dir, Pos, Target};
use korr_hunger::config::{DECAY, PECKISH, STARVING};
use korr_scenarios::{Act, Answer, Fake, run};

use super::{grazing, meadow, plant};

/// A rival that stays put against the wall north of a creature on the top row.
fn rival(band: Band, weight: u16) -> Vec<Act> {
    vec![Act {
        action: Fake::X,
        band,
        weight,
        target: Target::None,
        answer: Answer::Go(Dir::North),
    }]
}

/// Whether a creature at `satiety` before the round's decay grazes the
/// plant beside it over a rival.
fn grazes_over(satiety: u16, rival: Vec<Act>) -> bool {
    let game = grazing(rival);
    let food = Pos { x: 5, y: 1 };
    let (mut world, _) = meadow(&game, satiety, &[Pos { x: 4, y: 1 }], &[(food, 3)]);
    run(&game, &mut world, 1);
    plant(&game, &world, food) == 0
}

#[test]
fn a_sated_creature_does_not_graze() {
    assert!(!grazes_over(PECKISH + DECAY, vec![]));
}

#[test]
fn one_point_below_peckish_grazes() {
    assert!(grazes_over(PECKISH - 1 + DECAY, vec![]));
}

#[test]
fn hunger_outweighs_a_routine_as_satiety_falls() {
    assert!(!grazes_over(
        PECKISH - 50 + DECAY,
        rival(Band::Routine, 100)
    ));
    assert!(grazes_over(STARVING + DECAY, rival(Band::Routine, 100)));
}

#[test]
fn an_empty_stomach_outweighs_a_lighter_vigilance() {
    assert!(grazes_over(
        DECAY,
        rival(Band::Vigilance, u16::from(u8::MAX) - 1)
    ));
}

#[test]
fn a_starving_creature_grazes_before_any_routine() {
    assert!(grazes_over(0, rival(Band::Routine, u16::MAX)));
}

#[test]
fn a_creature_at_the_starving_line_keeps_to_its_routine() {
    assert!(!grazes_over(
        STARVING + DECAY,
        rival(Band::Routine, u16::MAX)
    ));
}

#[test]
fn one_point_below_the_starving_line_grazes_before_any_routine() {
    assert!(grazes_over(
        STARVING - 1 + DECAY,
        rival(Band::Routine, u16::MAX)
    ));
}
