use korr_core::mechanic::Pos;
use korr_hunger::config::{DECAY, PECKISH};
use korr_scenarios::run;

use super::{grazing, meadow};

#[test]
fn satiety_survives_a_save() {
    let game = grazing(vec![]);
    let plant = [(Pos { x: 6, y: 4 }, 3)];
    let start = || meadow(&game, PECKISH + 5 * DECAY, &[Pos { x: 4, y: 4 }], &plant).0;
    let mut uninterrupted = start();
    run(&game, &mut uninterrupted, 4);
    let world = start();
    let mut world = game.load(&game.save(&world)).expect("own save loads");
    run(&game, &mut world, 2);
    let mut world = game.load(&game.save(&world)).expect("own save loads");
    run(&game, &mut world, 2);
    assert_eq!(game.hash(&world), game.hash(&uninterrupted));
}
