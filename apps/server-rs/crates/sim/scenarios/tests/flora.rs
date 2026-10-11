use korr_core::host::{Floor, Game, Pos, Seed, World};
use korr_ecs::FloorId;
use korr_engine::Registry;
use korr_flora::Flora;
use korr_grid::Material;
use korr_scenarios::{floor, game, run};

const FLOOR: FloorId = FloorId(0);
const SEED: Seed = Seed(3);
const SEEDLING: Pos = Pos { x: 3, y: 3 };
const OTHER: Pos = Pos { x: 5, y: 5 };
/// Above any ripe value: the first tick brings it down to ripe.
const GROWN: u8 = 200;

fn flora_only() -> Game<Registry> {
    game(
        Registry {
            wander: None,
            ..Registry::default()
        },
        SEED,
    )
}

fn plant(game: &Game<Registry>, world: &World, at: Pos) -> u8 {
    world.floor(FLOOR).cell_value::<Flora>(game.ruleset(), at)
}

fn around(at: Pos) -> Vec<Pos> {
    (-1..=1)
        .flat_map(|dy| (-1..=1).map(move |dx| (dx, dy)))
        .filter(|&d| d != (0, 0))
        .map(|(dx, dy)| Pos {
            x: at.x + dx,
            y: at.y + dy,
        })
        .collect()
}

/// One plant at `value` every third cell from (3, 3): no bare cell has two lattice neighbours.
fn sown(game: &Game<Registry>, side: u16, value: u8) -> Floor {
    let mut f = floor(game.ruleset(), FLOOR, side, side);
    for at in lattice(side) {
        f.set_cell_value::<Flora>(game.ruleset(), at, value);
    }
    f
}

fn lattice(side: u16) -> Vec<Pos> {
    let steps = || (3..side.cast_signed() - 3).step_by(3);
    steps()
        .flat_map(|y| steps().map(move |x| Pos { x, y }))
        .collect()
}

fn interior(side: u16) -> Vec<Pos> {
    let last = side.cast_signed() - 2;
    (1..=last)
        .flat_map(|y| (1..=last).map(move |x| Pos { x, y }))
        .collect()
}

fn planted_off(game: &Game<Registry>, world: &World, side: u16) -> usize {
    let lattice = lattice(side);
    interior(side)
        .into_iter()
        .filter(|at| !lattice.contains(at) && plant(game, world, *at) != 0)
        .count()
}

#[test]
fn a_seedling_grows_one_step_per_round_then_stays_ripe() {
    let game = flora_only();
    let mut f = floor(game.ruleset(), FLOOR, 8, 8);
    f.set_cell_value::<Flora>(game.ruleset(), SEEDLING, 1);
    let mut world = World::new(vec![f]);
    let mut values = Vec::new();
    for _ in 0..300 {
        game.run_round(&mut world);
        values.push(plant(&game, &world, SEEDLING));
    }
    let ripe = values[299];
    assert!(ripe > 1, "the seedling never grew");
    assert!(ripe < u8::MAX, "growth stopped only by saturation");
    for (k, &value) in (1u16..).zip(&values) {
        let expected = u8::try_from((1 + k).min(u16::from(ripe))).expect("ripe fits u8");
        assert_eq!(value, expected, "round {k}");
    }
}

#[test]
fn a_plant_on_a_wall_withers() {
    let game = flora_only();
    let mut f = floor(game.ruleset(), FLOOR, 8, 8);
    f.set_cell_value::<Flora>(game.ruleset(), SEEDLING, 1);
    f.set_cell_value::<Flora>(game.ruleset(), OTHER, 1);
    f.set_material(OTHER, Material::WALL);
    let mut world = World::new(vec![f]);
    run(&game, &mut world, 1);
    assert_eq!(plant(&game, &world, OTHER), 0);
    assert_eq!(plant(&game, &world, SEEDLING), 2);
}

#[test]
fn bare_ground_with_no_plant_near_stays_bare() {
    let game = flora_only();
    let f = floor(game.ruleset(), FLOOR, 8, 8);
    let mut world = World::new(vec![f]);
    run(&game, &mut world, 100);
    for y in 1..=6 {
        for x in 1..=6 {
            assert_eq!(plant(&game, &world, Pos { x, y }), 0, "({x}, {y})");
        }
    }
}

#[test]
fn a_seedling_does_not_spread_until_ripe() {
    let game = flora_only();
    let mut f = floor(game.ruleset(), FLOOR, 8, 8);
    f.set_cell_value::<Flora>(game.ruleset(), SEEDLING, 1);
    let mut world = World::new(vec![f]);
    let mut grown_before = plant(&game, &world, SEEDLING);
    let mut ripe = None;
    for round in 1..=200 {
        game.run_round(&mut world);
        let now = plant(&game, &world, SEEDLING);
        ripe = ripe.or((now == grown_before).then_some(now));
        let sprouted = around(SEEDLING)
            .into_iter()
            .any(|at| plant(&game, &world, at) != 0);
        // A plant that was still growing at the start of the round cannot have seeded it.
        assert!(
            ripe.is_some() || !sprouted,
            "spread from a seedling in round {round}"
        );
        grown_before = now;
        if sprouted {
            return;
        }
    }
    panic!("a ripe plant never spread");
}

#[test]
fn each_cell_beside_a_ripe_plant_sprouts_on_its_own_draw() {
    let game = flora_only();
    let mut f = floor(game.ruleset(), FLOOR, 8, 8);
    f.set_cell_value::<Flora>(game.ruleset(), SEEDLING, GROWN);
    let mut world = World::new(vec![f]);
    for _ in 0..200 {
        game.run_round(&mut world);
        let sprouted = around(SEEDLING)
            .into_iter()
            .filter(|&at| plant(&game, &world, at) != 0)
            .count();
        if sprouted > 0 {
            assert!(sprouted < 8, "all eight cells sprouted together");
            return;
        }
    }
    panic!("a ripe plant never spread");
}

#[test]
fn a_cleared_cell_among_ripe_plants_regrows() {
    let game = flora_only();
    let mut f = floor(game.ruleset(), FLOOR, 8, 8);
    for at in around(SEEDLING) {
        f.set_cell_value::<Flora>(game.ruleset(), at, GROWN);
    }
    let mut world = World::new(vec![f]);
    run(&game, &mut world, 100);
    assert_ne!(plant(&game, &world, SEEDLING), 0);
}

#[test]
fn the_same_cell_of_two_floors_draws_differently() {
    let game = flora_only();
    let floors = [FloorId(0), FloorId(1)].map(|id| {
        let mut f = floor(game.ruleset(), id, 8, 8);
        f.set_cell_value::<Flora>(game.ruleset(), SEEDLING, GROWN);
        f
    });
    let mut world = World::new(floors.into());
    run(&game, &mut world, 40);
    let picture = |id: FloorId| -> Vec<u8> {
        (1..=6)
            .flat_map(|y| (1..=6).map(move |x| Pos { x, y }))
            .map(|at| world.floor(id).cell_value::<Flora>(game.ruleset(), at))
            .collect()
    };
    assert_ne!(picture(FloorId(0)), picture(FloorId(1)));
}

#[test]
fn seeds_fall_only_from_plants_ripe_before_the_round() {
    const SIDE: u16 = 64;
    let game = flora_only();
    let mut world = World::new(vec![sown(&game, SIDE, 1)]);
    let one = lattice(SIDE)[0];
    let mut rounds = Vec::new();
    for _ in 0..300 {
        let before = plant(&game, &world, one);
        game.run_round(&mut world);
        rounds.push((before, planted_off(&game, &world, SIDE)));
    }
    let ripe = plant(&game, &world, one);
    for (k, &(before, sprouted)) in rounds.iter().enumerate() {
        if before < ripe {
            assert_eq!(sprouted, 0, "seeded by a plant still growing in round {k}");
        }
    }
    assert_ne!(planted_off(&game, &world, SIDE), 0, "no seed ever fell");
}

#[test]
fn some_but_not_all_bare_neighbours_sprout_each_round() {
    const SIDE: u16 = 64;
    let game = flora_only();
    let mut world = World::new(vec![sown(&game, SIDE, u8::MAX)]);
    let beside = 8 * lattice(SIDE).len();
    game.run_round(&mut world);
    let first = planted_off(&game, &world, SIDE);
    assert!(0 < first && first < beside, "{first} of {beside} sprouted");
    game.run_round(&mut world);
    let second = planted_off(&game, &world, SIDE);
    assert!(second > first, "no new sprout in round 2");
}

#[test]
fn a_reload_mid_growth_replays_the_same_world() {
    const SIDE: u16 = 32;
    let game = flora_only();
    let picture = |world: &World| -> Vec<u8> {
        interior(SIDE)
            .into_iter()
            .map(|at| plant(&game, world, at))
            .collect()
    };
    let mut unbroken = World::new(vec![sown(&game, SIDE, 1)]);
    run(&game, &mut unbroken, 30);
    let mut resumed = World::new(vec![sown(&game, SIDE, 1)]);
    run(&game, &mut resumed, 12);
    let mut resumed = game.load(&game.save(&resumed)).expect("own save loads");
    run(&game, &mut resumed, 18);
    assert_eq!(picture(&resumed), picture(&unbroken));
    assert_eq!(game.hash(&resumed), game.hash(&unbroken));
}

#[test]
fn flora_disabled_the_game_runs() {
    let game = game(
        Registry {
            flora: None,
            ..Registry::default()
        },
        SEED,
    );
    let mut f = floor(game.ruleset(), FLOOR, 8, 8);
    let start: Vec<Pos> = (2..=5).map(|x| Pos { x, y: 3 }).collect();
    let actors: Vec<_> = start
        .iter()
        .map(|&p| f.spawn_actor(game.ruleset(), p))
        .collect();
    let mut world = World::new(vec![f]);
    run(&game, &mut world, 20);
    let floor = world.floor(FLOOR);
    assert!(
        actors
            .iter()
            .zip(&start)
            .any(|(&h, &p)| floor.pos(h) != Some(p)),
        "no wanderer moved"
    );
}
