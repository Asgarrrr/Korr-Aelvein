use korr_core::{Floor, LoadError, Mechanics, Pos, Ruleset, Seed, TICKS_PER_ROUND, World};
use korr_ecs::{ImageError, SchemaBuilder, checksum};
use korr_engine::Registry;
use korr_scenarios::{Pace, floor};

const SEED: Seed = Seed(7);
/// Re-pin on every intended change to the image format or to behaviour.
const PINNED: u64 = 0x74de_a463_5b75_44e9;

fn ruleset(mechanics: &impl Mechanics) -> Ruleset {
    Ruleset::new(SchemaBuilder::default(), mechanics)
}

/// 40 actors, two per row. The fast even id starts at x = 3: blocked by the
/// wall from tick 570, its clock stays off the round boundary. The slow odd
/// id starts at x = 1: it takes its last step after a save at round 20.
fn populated(ruleset: &Ruleset) -> Floor {
    let mut f = floor(ruleset, 0, 24, 24);
    for y in 1..=20 {
        for x in [3, 1] {
            f.spawn_actor(ruleset, Pos { x, y });
        }
    }
    f
}

fn run(world: &mut World, ruleset: &Ruleset, rounds: u64) {
    for _ in 0..rounds {
        world.run_round(ruleset, &Pace);
    }
}

fn uninterrupted_hash(rounds: u64) -> u64 {
    let ruleset = ruleset(&Pace);
    let mut world = World::new(SEED, vec![populated(&ruleset)]);
    run(&mut world, &ruleset, rounds);
    world.hash(&ruleset)
}

#[test]
fn same_seed_same_world_hash() {
    assert_eq!(uninterrupted_hash(50), PINNED);
}

/// Pace draws nothing: this world pins draw addressing. Re-pin on every
/// intended change to a draw or to wander.
const PINNED_WANDER: u64 = 0x9419_ab3a_d669_63c9;

#[test]
fn wander_world_hash_pins_the_draws() {
    let registry = Registry::default();
    let ruleset = ruleset(&registry);
    let mut world = World::new(SEED, vec![populated(&ruleset)]);
    for _ in 0..20 {
        world.run_round(&ruleset, &registry);
    }
    assert_eq!(world.hash(&ruleset), PINNED_WANDER);
}

#[test]
fn save_reload_replay_matches_the_uninterrupted_run() {
    let saved: Vec<Vec<u8>> = {
        let ruleset = ruleset(&Pace);
        let mut world = World::new(SEED, vec![populated(&ruleset)]);
        run(&mut world, &ruleset, 20);
        world.floors().iter().map(|f| f.save(&ruleset)).collect()
    };
    let ruleset = ruleset(&Pace);
    let floors = saved
        .iter()
        .map(|bytes| Floor::load(&ruleset, bytes).expect("own save loads"))
        .collect();
    let mut world = World::new(SEED, floors);
    run(&mut world, &ruleset, 30);
    assert_eq!(world.hash(&ruleset), uninterrupted_hash(50));
}

#[test]
fn a_changed_ruleset_refuses_the_save() {
    let saving = ruleset(&Registry::default());
    let bytes = populated(&saving).save(&saving);
    let running = ruleset(&Registry { wander: None });
    assert!(matches!(
        Floor::load(&running, &bytes),
        Err(LoadError::Ruleset { .. })
    ));
}

#[test]
fn forged_round_is_corrupt_not_a_panic() {
    let ruleset = ruleset(&Pace);
    let mut bytes = populated(&ruleset).save(&ruleset);
    bytes[..8].copy_from_slice(&u64::MAX.to_le_bytes());
    let body = bytes.len() - 8;
    let sum = checksum(&bytes[..body]);
    bytes[body..].copy_from_slice(&sum.to_le_bytes());
    assert_eq!(
        Floor::load(&ruleset, &bytes).err(),
        Some(LoadError::Image(ImageError::Corrupt("round")))
    );
}

fn reseal(bytes: &mut [u8]) {
    let body = bytes.len() - 8;
    let sum = checksum(&bytes[..body]);
    bytes[body..].copy_from_slice(&sum.to_le_bytes());
}

fn position_of(haystack: &[u8], needle: &[u8]) -> usize {
    haystack
        .windows(needle.len())
        .position(|w| w == needle)
        .expect("needle is in the image")
}

/// Rewrites the store image inside a saved floor and seals both checksums.
fn forge_store(bytes: &[u8], edit: impl FnOnce(&mut Vec<u8>)) -> Vec<u8> {
    let store_len = u32::from_le_bytes(bytes[16..20].try_into().expect("4 bytes")) as usize;
    let mut store = bytes[20..20 + store_len].to_vec();
    edit(&mut store);
    reseal(&mut store);

    let mut forged = bytes[..16].to_vec();
    forged.extend_from_slice(&u32::try_from(store.len()).expect("fits u32").to_le_bytes());
    forged.extend_from_slice(&store);
    forged.extend_from_slice(&bytes[20 + store_len..]);
    reseal(&mut forged);
    forged
}

/// The offset of the clock column's row count in a store image.
fn clock_count_at(store: &[u8]) -> usize {
    position_of(store, b"core.clock") + b"core.clock".len()
}

fn corrupt(what: &'static str) -> LoadError {
    LoadError::Image(ImageError::Corrupt(what))
}

#[test]
fn placed_actor_without_a_clock_is_corrupt() {
    let ruleset = ruleset(&Pace);
    let mut f = floor(&ruleset, 0, 8, 4);
    f.spawn_actor(&ruleset, Pos { x: 1, y: 1 });
    let forged = forge_store(&f.save(&ruleset), |store| {
        let count_at = clock_count_at(store);
        assert_eq!(store[count_at..count_at + 4], 1u32.to_le_bytes());
        // The count, then one row: owner slot (4 bytes) and tick (8 bytes).
        store[count_at..count_at + 4].copy_from_slice(&0u32.to_le_bytes());
        store.drain(count_at + 4..count_at + 16);
    });
    assert_eq!(
        Floor::load(&ruleset, &forged).err(),
        Some(corrupt("placed actor without a clock"))
    );
}

#[test]
fn clock_of_a_thing_is_corrupt() {
    let ruleset = ruleset(&Pace);
    let mut f = floor(&ruleset, 0, 8, 4);
    f.spawn_actor(&ruleset, Pos { x: 1, y: 1 });
    f.spawn_thing(Pos { x: 2, y: 1 });
    let forged = forge_store(&f.save(&ruleset), |store| {
        let owner_at = clock_count_at(store) + 4;
        assert_eq!(store[owner_at..owner_at + 4], 0u32.to_le_bytes());
        store[owner_at..owner_at + 4].copy_from_slice(&1u32.to_le_bytes());
    });
    assert_eq!(
        Floor::load(&ruleset, &forged).err(),
        Some(corrupt("clock of an unplaced actor"))
    );
}

/// The load result of a floor at round 1 whose only actor has `tick` as clock.
fn load_with_clock(tick: u64) -> Option<LoadError> {
    let ruleset = ruleset(&Pace);
    let mut f = floor(&ruleset, 0, 8, 4);
    f.spawn_actor(&ruleset, Pos { x: 1, y: 1 });
    let mut world = World::new(SEED, vec![f]);
    run(&mut world, &ruleset, 1);
    let forged = forge_store(&world.floors()[0].save(&ruleset), |store| {
        let tick_at = clock_count_at(store) + 8;
        store[tick_at..tick_at + 8].copy_from_slice(&tick.to_le_bytes());
    });
    Floor::load(&ruleset, &forged).err()
}

#[test]
fn clock_before_the_round_is_corrupt() {
    assert_eq!(
        load_with_clock(TICKS_PER_ROUND - 1),
        Some(corrupt("clock out of range"))
    );
}

#[test]
fn clock_past_one_maximal_cost_is_corrupt() {
    let past = TICKS_PER_ROUND + u64::from(u32::MAX) + 1;
    assert_eq!(load_with_clock(past), Some(corrupt("clock out of range")));
}
