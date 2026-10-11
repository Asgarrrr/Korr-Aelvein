use korr_core::host::{Floor, Pos, Round, Ruleset, Seed, World, WorldError};
use korr_ecs::{FloorId, Handle};
use korr_engine::Registry;
use korr_grid::Material;
use korr_scenarios::{Pace, floor, game, run};

const FLOOR: FloorId = FloorId(0);

fn spawn_all(floor: &mut Floor, ruleset: &Ruleset, cells: &[Pos]) -> Vec<Handle> {
    cells
        .iter()
        .map(|&p| floor.spawn_actor(ruleset, p))
        .collect()
}

fn positions(world: &World, actors: &[Handle]) -> Vec<Pos> {
    let floor = world.floor(FLOOR);
    actors
        .iter()
        .map(|&h| floor.pos(h).expect("every actor stays placed"))
        .collect()
}

fn in_block(p: Pos) -> bool {
    (6..10).contains(&p.x) && (6..10).contains(&p.y)
}

#[test]
fn wanderers_spread_and_never_share_a_cell() {
    let game = game(Registry::default(), Seed(1));
    let mut f = floor(game.ruleset(), FloorId(0), 16, 16);
    let block: Vec<Pos> = (6..10)
        .flat_map(|y| (6..10).map(move |x| Pos { x, y }))
        .collect();
    let wanderers = spawn_all(&mut f, game.ruleset(), &block);
    let mut world = World::new(vec![f]);
    for _ in 0..40 {
        game.run_round(&mut world);
        let cells = positions(&world, &wanderers);
        for (i, a) in cells.iter().enumerate() {
            assert!(!cells[i + 1..].contains(a), "two wanderers share {a:?}");
        }
    }
    let outside = positions(&world, &wanderers)
        .into_iter()
        .filter(|&p| !in_block(p))
        .count();
    assert!(outside >= 9, "only {outside} of 16 left the block");
}

#[test]
fn walled_in_wanderer_still_ends_the_round() {
    let centre = Pos { x: 2, y: 2 };
    let game = game(Registry::default(), Seed(1));
    let mut f = floor(game.ruleset(), FloorId(0), 5, 5);
    for y in 1..=3 {
        for x in 1..=3 {
            let p = Pos { x, y };
            if p != centre {
                f.set_material(p, Material::WALL);
            }
        }
    }
    let wanderer = f.spawn_actor(game.ruleset(), centre);
    let mut world = World::new(vec![f]);
    run(&game, &mut world, 10);
    assert_eq!(world.floor(FLOOR).round(), Round(10));
    assert_eq!(world.floor(FLOOR).pos(wanderer), Some(centre));
}

#[test]
fn wander_disabled_creatures_idle() {
    let game = game(Registry { wander: None }, Seed(1));
    let mut f = floor(game.ruleset(), FloorId(0), 6, 4);
    let cells: Vec<Pos> = (1..=2)
        .flat_map(|y| (1..=4).map(move |x| Pos { x, y }))
        .collect();
    let actors = spawn_all(&mut f, game.ruleset(), &cells);
    let mut world = World::new(vec![f]);
    run(&game, &mut world, 10);
    assert_eq!(positions(&world, &actors), cells);
    assert_eq!(world.floor(FLOOR).round(), Round(10));
}

#[test]
fn cheap_actions_take_several_turns_per_round() {
    let game = game(Pace, Seed(1));
    let mut f = floor(game.ruleset(), FloorId(0), 12, 4);
    // Spawn order sets the ids: the first actor's id is even, so it pays 30.
    let actors = spawn_all(
        &mut f,
        game.ruleset(),
        &[Pos { x: 1, y: 1 }, Pos { x: 1, y: 2 }],
    );
    let mut world = World::new(vec![f]);
    run(&game, &mut world, 1);
    assert_eq!(
        positions(&world, &actors),
        [Pos { x: 5, y: 1 }, Pos { x: 2, y: 2 }]
    );
}

#[test]
fn duplicate_floor_ids_are_refused() {
    let game = game(Pace, Seed(1));
    let floors = vec![
        floor(game.ruleset(), FloorId(0), 5, 5),
        floor(game.ruleset(), FloorId(0), 5, 5),
    ];
    assert_eq!(
        World::try_new(floors).err(),
        Some(WorldError::DuplicateFloor(FLOOR))
    );
}
