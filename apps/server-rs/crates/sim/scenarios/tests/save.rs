use korr_core::host::{Game, LoadError, Pos, Ruleset, Seed, World, WorldError};
use korr_ecs::{EntityId, FloorId, ImageError};
use korr_scenarios::{Leave, Pace, floor, game, reload, run};

const SEED: Seed = Seed(7);
const A: FloorId = FloorId(0);
const B: FloorId = FloorId(1);
const C: FloorId = FloorId(2);
const TO_B: Leave = Leave {
    to: B,
    at: Pos { x: 3, y: 3 },
};

/// A's 3 actors leave for B in round 0: after it, B holds A:0..2.
fn left(game: &Game<Leave>) -> World {
    let ruleset = game.ruleset();
    let mut a = floor(ruleset, A, 7, 7);
    for x in 1..=3 {
        a.spawn_actor(ruleset, Pos { x, y: 1 });
    }
    let mut world = World::new(vec![a, floor(ruleset, B, 7, 7)]);
    run(game, &mut world, 1);
    world
}

#[test]
fn a_save_under_another_seed_is_refused() {
    let saving = game(TO_B, Seed(7));
    let bytes = saving.save(&left(&saving));
    assert_eq!(
        game(TO_B, Seed(8)).load(&bytes).err(),
        Some(LoadError::Seed {
            saved: 7,
            running: 8
        })
    );
}

#[test]
fn a_save_of_another_format_is_refused() {
    let game = game(TO_B, SEED);
    let bytes = game.save(&left(&game));
    let mut foreign = bytes.clone();
    foreign[0] ^= 1;
    assert_eq!(
        game.load(&foreign).err(),
        Some(LoadError::Image(ImageError::Magic))
    );
    let mut newer = bytes;
    newer[8..10].copy_from_slice(&3u16.to_le_bytes());
    assert_eq!(
        game.load(&newer).err(),
        Some(LoadError::Image(ImageError::Version(3)))
    );
}

#[test]
fn an_id_beyond_its_origin_counter_is_refused() {
    let game = game(TO_B, SEED);
    let ruleset = game.ruleset();
    let mut fresh = World::new(vec![floor(ruleset, A, 7, 7)]);
    run(&game, &mut fresh, 1);
    let floors = vec![
        reload(ruleset, fresh.floor(A)),
        reload(ruleset, left(&game).floor(B)),
    ];
    assert_eq!(
        World::try_new(floors).err(),
        Some(WorldError::BeyondCounter(EntityId::new(A, 0)))
    );
}

#[test]
fn an_id_from_an_absent_floor_is_refused() {
    let game = game(TO_B, SEED);
    let floors = vec![reload(game.ruleset(), left(&game).floor(B))];
    assert_eq!(
        World::try_new(floors).err(),
        Some(WorldError::UnknownOrigin(EntityId::new(A, 0)))
    );
}

/// B holds A:0..2 beyond fresh A's counter and C:0 from absent C.
#[test]
fn the_lowest_failing_id_decides() {
    let game = game(TO_B, SEED);
    let ruleset = game.ruleset();
    let mut a = floor(ruleset, A, 7, 7);
    for x in 1..=3 {
        a.spawn_actor(ruleset, Pos { x, y: 1 });
    }
    let mut c = floor(ruleset, C, 7, 7);
    c.spawn_actor(ruleset, Pos { x: 1, y: 1 });
    let mut world = World::new(vec![a, floor(ruleset, B, 7, 7), c]);
    run(&game, &mut world, 1);
    let mut fresh = World::new(vec![floor(ruleset, A, 7, 7)]);
    run(&game, &mut fresh, 1);
    let floors = vec![
        reload(ruleset, world.floor(B)),
        reload(ruleset, fresh.floor(A)),
    ];
    assert_eq!(
        World::try_new(floors).err(),
        Some(WorldError::BeyondCounter(EntityId::new(A, 0)))
    );
}

/// A Save holding `floors`, framed by hand.
fn framed(seed: Seed, floors: &[Vec<u8>]) -> Vec<u8> {
    let mut bytes = b"KORRSAV\0".to_vec();
    bytes.extend_from_slice(&2u16.to_le_bytes());
    bytes.extend_from_slice(&seed.0.to_le_bytes());
    bytes.extend_from_slice(&u32::try_from(floors.len()).expect("fits u32").to_le_bytes());
    for image in floors {
        bytes.extend_from_slice(&u32::try_from(image.len()).expect("fits u32").to_le_bytes());
        bytes.extend_from_slice(image);
    }
    bytes
}

#[test]
fn load_reports_world_errors() {
    let game = game(TO_B, SEED);
    let bytes = framed(SEED, &[left(&game).floor(B).save(game.ruleset())]);
    assert_eq!(
        game.load(&bytes).err(),
        Some(LoadError::World(WorldError::UnknownOrigin(EntityId::new(
            A, 0
        ))))
    );
}

#[test]
fn no_truncation_or_byte_flip_loads_or_panics() {
    let game = game(TO_B, SEED);
    let bytes = game.save(&left(&game));
    assert!(game.load(&bytes).is_ok());
    for n in 0..bytes.len() {
        assert!(game.load(&bytes[..n]).is_err(), "prefix of {n} bytes loads");
    }
    for i in 0..bytes.len() {
        let mut flipped = bytes.clone();
        flipped[i] ^= 0xFF;
        assert!(game.load(&flipped).is_err(), "flip at byte {i} loads");
    }
}

#[test]
fn trailing_bytes_are_refused() {
    let game = game(TO_B, SEED);
    let mut bytes = game.save(&left(&game));
    bytes.push(0);
    assert_eq!(
        game.load(&bytes).err(),
        Some(LoadError::Image(ImageError::Trailing(1)))
    );
}

#[test]
fn floors_are_saved_in_ascending_id() {
    let game = game(TO_B, SEED);
    let ruleset = game.ruleset();
    let world = World::new(vec![floor(ruleset, B, 7, 7), floor(ruleset, A, 7, 7)]);
    let images = [
        floor(ruleset, A, 7, 7).save(ruleset),
        floor(ruleset, B, 7, 7).save(ruleset),
    ];
    assert_eq!(game.save(&world), framed(SEED, &images));
}

#[test]
fn floors_out_of_ascending_order_are_refused() {
    let game = game(TO_B, SEED);
    let ruleset = game.ruleset();
    let images = [
        floor(ruleset, B, 7, 7).save(ruleset),
        floor(ruleset, A, 7, 7).save(ruleset),
    ];
    assert_eq!(
        game.load(&framed(SEED, &images)).err(),
        Some(LoadError::Image(ImageError::Corrupt("floor order")))
    );
}

/// The fast even id is blocked by the wall from tick 570, its clock off the
/// round boundary. The slow odd id takes its last step after round 20.
fn paced(ruleset: &Ruleset) -> World {
    let mut f = floor(ruleset, A, 24, 24);
    for x in [3, 1] {
        f.spawn_actor(ruleset, Pos { x, y: 1 });
    }
    World::new(vec![f])
}

#[test]
fn save_load_replays() {
    let bytes = {
        let game = game(Pace, SEED);
        let mut world = paced(game.ruleset());
        run(&game, &mut world, 20);
        game.save(&world)
    };
    let game = game(Pace, SEED);
    let mut world = game.load(&bytes).expect("own save loads");
    run(&game, &mut world, 30);
    let mut uninterrupted = paced(game.ruleset());
    run(&game, &mut uninterrupted, 50);
    assert_eq!(game.hash(&world), game.hash(&uninterrupted));
}
