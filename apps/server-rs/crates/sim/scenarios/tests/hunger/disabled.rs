use korr_core::{
    host::{Floor, Round, Seed, World},
    mechanic::Pos,
};
use korr_ecs::FloorId;
use korr_engine::Registry;
use korr_scenarios::{floor, game, run};

#[test]
fn the_game_runs_without_hunger() {
    let game = game(
        Registry {
            hunger: false,
            ..Registry::default()
        },
        Seed(1),
    );
    let mut f: Floor = floor(game.ruleset(), FloorId(0), 6, 6);
    f.spawn_actor(game.ruleset(), Pos { x: 2, y: 2 });
    let mut world = World::new(vec![f]);
    run(&game, &mut world, 20);
    assert_eq!(world.floor(FloorId(0)).round(), Round(20));
}
