use korr_core::host::{Seed, World};
use korr_core::mechanic::Pos;
use korr_engine::Registry;
use korr_hunger::Diet;
use korr_scenarios::{floor, game, plants, run, stomach};

use super::MEADOW;

const HOME: Pos = Pos { x: 4, y: 4 };

/// The plant and the creature beside it after 20 rounds of the registry
/// without wander; the creature gets an empty stomach whenever hunger runs.
fn beside_a_seedling(hunger: bool) -> (u8, Option<Pos>) {
    let game = game(
        Registry {
            wander: false,
            hunger,
            ..Registry::default()
        },
        Seed(1),
    );
    let (ruleset, modules) = (game.ruleset(), game.mechanics());
    let food = Pos { x: 5, y: 4 };
    let mut f = floor(ruleset, MEADOW, 9, 9);
    f.set_cell(ruleset, plants(modules), food, 1);
    let h = f.spawn_actor(ruleset, HOME);
    if let Some(hunger) = &modules.hunger {
        stomach(&mut f, hunger, h, 0, Diet::PLANTS);
    }
    let mut world = World::new(vec![f]);
    run(&game, &mut world, 20);
    let f = world.floor(MEADOW);
    (f.cell(ruleset, plants(modules), food), f.pos(h))
}

#[test]
fn the_game_runs_without_hunger() {
    let (plant, at) = beside_a_seedling(false);
    assert!(plant > 1, "the seedling never grew");
    assert_eq!(at, Some(HOME));
    assert_eq!(beside_a_seedling(true).0, 0, "hunger never ate the plant");
}
