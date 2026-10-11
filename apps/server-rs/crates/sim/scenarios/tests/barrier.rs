use korr_core::host::{Pos, Seed, World};
use korr_ecs::FloorId;
use korr_scenarios::{Ring, TO_GROUND, floor, game, run};

const A: FloorId = FloorId(0);
const B: FloorId = FloorId(1);

#[test]
fn each_arrival_acts_the_round_after_it_lands() {
    let game = game(
        Ring {
            floors: 2,
            at: Pos { x: 1, y: 1 },
        },
        Seed(5),
    );
    let r = game.ruleset();
    let mut a = floor(r, A, 5, 5);
    for x in 1..=3 {
        a.spawn_actor(r, Pos { x, y: 1 });
    }
    let b = floor(r, B, 3, 3);
    let mut world = World::new(vec![a, b]);
    // B's single cell frees only when its holder leaves on the next round.
    let waiting: Vec<usize> = (0..2)
        .map(|_| {
            run(&game, &mut world, 1);
            world.floor(B).inbox_len()
        })
        .collect();
    assert_eq!(waiting, [2, 1]);
}

#[test]
#[should_panic(expected = "departure to a floor outside this world")]
fn a_departure_to_a_floor_outside_the_world_panics() {
    let game = game(TO_GROUND, Seed(5));
    let r = game.ruleset();
    let mut f = floor(r, FloorId(1), 5, 5);
    f.spawn_actor(r, Pos { x: 1, y: 1 });
    let mut world = World::new(vec![f]);
    run(&game, &mut world, 1);
}
