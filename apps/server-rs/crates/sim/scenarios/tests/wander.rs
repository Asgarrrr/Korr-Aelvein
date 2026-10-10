use korr_core::{Floor, Mechanics, Pos, Ruleset, Seed, World};
use korr_ecs::{FloorId, Handle, SchemaBuilder};
use korr_engine::Registry;
use korr_grid::Material;
use korr_scenarios::{Pace, floor};

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

fn ruleset(mechanics: &impl Mechanics) -> Ruleset {
    Ruleset::new(SchemaBuilder::default(), mechanics)
}

fn run(world: &mut World, ruleset: &Ruleset, mechanics: &impl Mechanics, rounds: u64) {
    for _ in 0..rounds {
        world.run_round(ruleset, mechanics);
    }
}

fn in_block(p: Pos) -> bool {
    (6..10).contains(&p.x) && (6..10).contains(&p.y)
}

#[test]
fn wanderers_spread_and_never_share_a_cell() {
    let registry = Registry::default();
    let ruleset = ruleset(&registry);
    let mut f = floor(&ruleset, 0, 16, 16);
    let block: Vec<Pos> = (6..10)
        .flat_map(|y| (6..10).map(move |x| Pos { x, y }))
        .collect();
    let wanderers = spawn_all(&mut f, &ruleset, &block);
    let mut world = World::new(Seed(1), vec![f]);
    for _ in 0..40 {
        world.run_round(&ruleset, &registry);
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
    let registry = Registry::default();
    let ruleset = ruleset(&registry);
    let mut f = floor(&ruleset, 0, 5, 5);
    for y in 1..=3 {
        for x in 1..=3 {
            let p = Pos { x, y };
            if p != centre {
                f.set_material(p, Material::WALL);
            }
        }
    }
    let wanderer = f.spawn_actor(&ruleset, centre);
    let mut world = World::new(Seed(1), vec![f]);
    run(&mut world, &ruleset, &registry, 10);
    assert_eq!(world.floor(FLOOR).round(), 10);
    assert_eq!(world.floor(FLOOR).pos(wanderer), Some(centre));
}

#[test]
fn wander_disabled_creatures_idle() {
    let registry = Registry { wander: None };
    let ruleset = ruleset(&registry);
    let mut f = floor(&ruleset, 0, 6, 4);
    let cells: Vec<Pos> = (1..=2)
        .flat_map(|y| (1..=4).map(move |x| Pos { x, y }))
        .collect();
    let actors = spawn_all(&mut f, &ruleset, &cells);
    let mut world = World::new(Seed(1), vec![f]);
    run(&mut world, &ruleset, &registry, 10);
    assert_eq!(positions(&world, &actors), cells);
    assert_eq!(world.floor(FLOOR).round(), 10);
}

#[test]
fn cheap_actions_take_several_turns_per_round() {
    let ruleset = ruleset(&Pace);
    let mut f = floor(&ruleset, 0, 12, 4);
    // Spawn order sets the ids: the first actor's id is even, so it pays 30.
    let actors = spawn_all(&mut f, &ruleset, &[Pos { x: 1, y: 1 }, Pos { x: 1, y: 2 }]);
    let mut world = World::new(Seed(1), vec![f]);
    run(&mut world, &ruleset, &Pace, 1);
    assert_eq!(
        positions(&world, &actors),
        [Pos { x: 5, y: 1 }, Pos { x: 2, y: 2 }]
    );
}

#[test]
#[should_panic(expected = "duplicate floor id")]
fn duplicate_floor_ids_are_refused() {
    let ruleset = ruleset(&Pace);
    let _ = World::new(
        Seed(1),
        vec![floor(&ruleset, 0, 5, 5), floor(&ruleset, 0, 5, 5)],
    );
}
