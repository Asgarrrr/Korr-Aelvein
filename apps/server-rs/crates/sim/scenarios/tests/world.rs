use korr_core::host::{Floor, Ruleset, Seed, World, WorldError};
use korr_ecs::FloorId;
use korr_scenarios::{Pace, floor, game};

fn floors(ruleset: &Ruleset, ids: &[u16]) -> Vec<Floor> {
    ids.iter()
        .map(|&id| floor(ruleset, FloorId(id), 5, 5))
        .collect()
}

#[test]
fn floors_are_listed_in_ascending_id() {
    let game = game(Pace, Seed(1));
    let world = World::new(floors(game.ruleset(), &[5, 0, 2]));
    let ids: Vec<FloorId> = world.floors().iter().map(Floor::id).collect();
    assert_eq!(ids, [FloorId(0), FloorId(2), FloorId(5)]);
}

#[test]
fn every_floor_is_found_by_its_id() {
    let game = game(Pace, Seed(1));
    let world = World::new(floors(game.ruleset(), &[5, 0, 2]));
    for id in [0, 2, 5] {
        assert_eq!(world.floor(FloorId(id)).id(), FloorId(id));
    }
}

#[test]
#[should_panic(expected = "no floor in this world")]
fn an_absent_floor_id_panics() {
    let game = game(Pace, Seed(1));
    let world = World::new(floors(game.ruleset(), &[5, 0, 2]));
    let _ = world.floor(FloorId(1));
}

#[test]
fn the_lowest_shared_floor_id_is_refused() {
    let game = game(Pace, Seed(1));
    assert_eq!(
        World::try_new(floors(game.ruleset(), &[2, 0, 2, 0])).err(),
        Some(WorldError::DuplicateFloor(FloorId(0)))
    );
}
