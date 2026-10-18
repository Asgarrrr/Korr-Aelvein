use korr_core::host::World;
use korr_core::mechanic::Pos;
use korr_hunger::Diet;
use korr_scenarios::{reload, run};

use super::{CARCASS, FIELD, MASS, carnivorous, field, laid, mass};

#[derive(Clone, Copy)]
enum Rounds {
    Unbroken,
    Reloaded,
}

/// The hash after 4 rounds of a carnivore 3 cells from remains, and
/// whether the remains are gone by then.
fn approached(rounds: Rounds) -> (u64, bool) {
    let game = carnivorous();
    let eater = (Pos { x: 7, y: 4 }, 0, Diet::REMAINS);
    let (mut world, _) = field(&game, &[(CARCASS, MASS)], &[eater]);
    run(&game, &mut world, 1);
    let [remains] = laid(&world)[..] else {
        panic!("one donor, one remains");
    };
    for _ in 0..4 {
        if matches!(rounds, Rounds::Reloaded) {
            world = World::new(vec![reload(game.ruleset(), world.floor(FIELD))]);
        }
        run(&game, &mut world, 1);
    }
    (game.hash(&world), mass(&game, &world, remains).is_none())
}

#[test]
fn a_reload_every_round_keeps_the_approach_to_remains() {
    let unbroken = approached(Rounds::Unbroken);
    assert!(unbroken.1, "the carnivore reaches and eats the remains");
    assert_eq!(approached(Rounds::Reloaded), unbroken);
}
