use korr_core::{
    host::{Round, Then, Vitality, World, keyed},
    mechanic::Pos,
};
use korr_engine::Registry;
use korr_scenarios::{Bleeds, Clot, Wound, floor, game, run};

use super::{Bleed, CARCASS, FIELD, MASS, SEED, laid, mass};

#[test]
fn the_game_runs_with_remains_and_without_hunger() {
    let game = game(
        Then(
            keyed(Bleed::build),
            Registry {
                hunger: false,
                ..Registry::default()
            },
        ),
        SEED,
    );
    let ruleset = game.ruleset();
    let mut f = floor(ruleset, FIELD, 9, 9);
    let h = f.spawn_actor(ruleset, CARCASS);
    f.init(ruleset.vitality(), h, Vitality { hp: 1, max: MASS });
    let (wound, clot) = game.mechanics().0.keys();
    f.insert(wound, h, Wound);
    f.insert(clot, h, Clot);
    f.spawn_actor(ruleset, Pos { x: 5, y: 4 });
    let mut world = World::new(vec![f]);
    run(&game, &mut world, 1);
    let [remains] = laid(&world)[..] else {
        panic!("one death, one remains");
    };
    assert_eq!(mass(&game, &world, remains), Some(MASS));
    run(&game, &mut world, 29);
    assert_eq!(world.floor(FIELD).round(), Round(30));
}
