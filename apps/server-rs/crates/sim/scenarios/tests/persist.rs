use korr_core::host::{
    Floor, LoadError, Pos, Round, Ruleset, Sections, Seed, TICKS_PER_ROUND, Then, World, keyed,
};
use korr_ecs::{Component, FloorId, Handle, ImageError, Reader, Writer, checksum};
use korr_engine::Registry;
use korr_scenarios::{Pace, actionless, floor, game, run};

const SEED: Seed = Seed(7);
/// Re-pin on every intended change to the image format or to behaviour.
const PINNED: u64 = 0x3d66_b458_c272_c931;

/// 40 actors, two per row. The fast even id starts at x = 3: blocked by the
/// wall from tick 570, its clock stays off the round boundary. The slow odd
/// id starts at x = 1: it takes its last step after round 20.
fn populated(ruleset: &Ruleset) -> (Floor, Vec<Handle>) {
    let mut f = floor(ruleset, FloorId(0), 24, 24);
    let mut actors = Vec::new();
    for y in 1..=20 {
        for x in [3, 1] {
            actors.push(f.spawn_actor(ruleset, Pos { x, y }));
        }
    }
    (f, actors)
}

fn uninterrupted_hash(rounds: u64) -> u64 {
    let game = game(Pace, SEED);
    let mut world = World::new(vec![populated(game.ruleset()).0]);
    run(&game, &mut world, rounds);
    game.hash(&world)
}

#[test]
fn same_seed_same_world_hash() {
    assert_eq!(uninterrupted_hash(50), PINNED);
}

#[test]
fn save_load_replay_matches_the_pinned_run() {
    let bytes = {
        let game = game(Pace, SEED);
        let mut world = World::new(vec![populated(game.ruleset()).0]);
        run(&game, &mut world, 20);
        game.save(&world)
    };
    let game = game(Pace, SEED);
    let mut world = game.load(&bytes).expect("own save loads");
    run(&game, &mut world, 30);
    assert_eq!(game.hash(&world), PINNED);
}

/// The whole image under wander: its saved intent and ruleset fingerprint,
/// which positions alone miss. Any behaviour or floor image change moves it.
const PINNED_WANDER: u64 = 0xf3e4_5675_08b2_d230;

#[test]
fn wander_world_hash_pins_the_image() {
    let game = game(Registry::default(), SEED);
    let mut world = World::new(vec![populated(game.ruleset()).0]);
    run(&game, &mut world, 20);
    assert_eq!(game.hash(&world), PINNED_WANDER);
}

/// Positions alone, outside any image: any behaviour change may move it, a
/// format change never does.
const PINNED_DRAWS: u64 = 0xe258_a413_e4ea_1633;

#[test]
fn wander_positions_pin_the_draws() {
    let game = game(Registry::default(), SEED);
    let (f, actors) = populated(game.ruleset());
    let mut world = World::new(vec![f]);
    run(&game, &mut world, 20);
    let floor = world.floor(FloorId(0));
    let bytes: Vec<u8> = actors
        .iter()
        .map(|&h| floor.pos(h).expect("every actor stays placed"))
        .flat_map(|p| [p.x.to_le_bytes(), p.y.to_le_bytes()].concat())
        .collect();
    assert_eq!(checksum(&bytes), PINNED_DRAWS);
}

#[test]
fn a_changed_ruleset_refuses_the_save() {
    let saving = game(Registry::default(), SEED);
    let bytes = populated(saving.ruleset()).0.save(saving.ruleset());
    let changed = [
        Registry {
            wander: false,
            ..Registry::default()
        },
        Registry {
            flora: false,
            ..Registry::default()
        },
        Registry {
            hunger: false,
            ..Registry::default()
        },
    ];
    for registry in changed {
        let label = format!("{registry:?}");
        let running = game(registry, SEED);
        assert!(
            matches!(
                Floor::load(running.ruleset(), &bytes),
                Err(LoadError::Ruleset { .. })
            ),
            "{label} loads the save"
        );
    }
}

// Names that differ in their bytes but not in their length.
actionless!(Alpha, "alpha");
actionless!(Omega, "omega");

#[test]
fn a_renamed_module_refuses_the_save() {
    let saving = game(Alpha, SEED);
    let bytes = floor(saving.ruleset(), FloorId(0), 4, 4).save(saving.ruleset());
    let running = game(Omega, SEED);
    assert!(matches!(
        Floor::load(running.ruleset(), &bytes),
        Err(LoadError::Ruleset { .. })
    ));
}

struct MarkV0;

impl Component for MarkV0 {
    const VERSION: u16 = 0;

    fn write(&self, _: &mut Writer) {}

    fn read(_: &mut Reader<'_>) -> Result<Self, ImageError> {
        Ok(Self)
    }
}

struct MarkV1;

impl Component for MarkV1 {
    const VERSION: u16 = 1;

    fn write(&self, _: &mut Writer) {}

    fn read(_: &mut Reader<'_>) -> Result<Self, ImageError> {
        Ok(Self)
    }
}

actionless!(Holder, "holder");

#[test]
fn a_changed_component_encoding_refuses_the_save() {
    let game0 = game(
        Then(
            Pace,
            keyed(|b| {
                b.own::<MarkV0>("mark");
                Holder
            }),
        ),
        SEED,
    );
    let game1 = game(
        Then(
            Pace,
            keyed(|b| {
                b.own::<MarkV1>("mark");
                Holder
            }),
        ),
        SEED,
    );
    let bytes = populated(game0.ruleset()).0.save(game0.ruleset());
    assert!(matches!(
        Floor::load(game1.ruleset(), &bytes),
        Err(LoadError::Ruleset { .. })
    ));
}

#[test]
fn forged_round_is_corrupt_not_a_panic() {
    let game = game(Pace, SEED);
    let ruleset = game.ruleset();
    let mut sections =
        Sections::parse(&populated(ruleset).0.save(ruleset)).expect("own save parses");
    sections.round = Round(u64::MAX);
    assert_eq!(
        Floor::load(ruleset, &sections.seal()).err(),
        Some(LoadError::Image(ImageError::Corrupt("round")))
    );
}

/// Rewrites the store image inside a saved floor and seals both checksums.
fn forge_store(bytes: &[u8], edit: impl FnOnce(&mut Vec<u8>)) -> Vec<u8> {
    let mut sections = Sections::parse(bytes).expect("own save parses");
    edit(&mut sections.store);
    let body = sections.store.len() - 8;
    let sum = checksum(&sections.store[..body]);
    sections.store[body..].copy_from_slice(&sum.to_le_bytes());
    sections.seal()
}

/// The offset of the clock column's row count in a store image that holds one
/// clock and no vitality or remains. Core registers the clock, then those two:
/// its one row of owner slot (4 bytes) and tick (8 bytes) precedes two empty
/// columns of prefix (8 bytes) and count (4 bytes), then the checksum.
fn clock_count_at(store: &[u8]) -> usize {
    let at = store.len() - 8 - 2 * 12 - 12 - 4;
    assert_eq!(
        store[at..at + 4],
        1u32.to_le_bytes(),
        "one clock row ends the image"
    );
    at
}

fn corrupt(what: &'static str) -> LoadError {
    LoadError::Image(ImageError::Corrupt(what))
}

#[test]
fn placed_actor_without_a_clock_is_corrupt() {
    let game = game(Pace, SEED);
    let ruleset = game.ruleset();
    let mut f = floor(ruleset, FloorId(0), 8, 4);
    f.spawn_actor(ruleset, Pos { x: 1, y: 1 });
    let forged = forge_store(&f.save(ruleset), |store| {
        let count_at = clock_count_at(store);
        store[count_at..count_at + 4].copy_from_slice(&0u32.to_le_bytes());
        store.drain(count_at + 4..count_at + 16);
    });
    assert_eq!(
        Floor::load(ruleset, &forged).err(),
        Some(corrupt("placed actor without a clock"))
    );
}

#[test]
fn clock_of_a_thing_is_corrupt() {
    let game = game(Pace, SEED);
    let ruleset = game.ruleset();
    let mut f = floor(ruleset, FloorId(0), 8, 4);
    f.spawn_actor(ruleset, Pos { x: 1, y: 1 });
    f.spawn_thing(Pos { x: 2, y: 1 });
    let forged = forge_store(&f.save(ruleset), |store| {
        let owner_at = clock_count_at(store) + 4;
        assert_eq!(store[owner_at..owner_at + 4], 0u32.to_le_bytes());
        store[owner_at..owner_at + 4].copy_from_slice(&1u32.to_le_bytes());
    });
    assert_eq!(
        Floor::load(ruleset, &forged).err(),
        Some(corrupt("clock of an unplaced actor"))
    );
}

/// The load result of a floor at round 1 whose only actor has `tick` as clock.
fn load_with_clock(tick: u64) -> Option<LoadError> {
    let game = game(Pace, SEED);
    let ruleset = game.ruleset();
    let mut f = floor(ruleset, FloorId(0), 8, 4);
    f.spawn_actor(ruleset, Pos { x: 1, y: 1 });
    let mut world = World::new(vec![f]);
    run(&game, &mut world, 1);
    let forged = forge_store(&world.floors()[0].save(ruleset), |store| {
        let tick_at = clock_count_at(store) + 8;
        store[tick_at..tick_at + 8].copy_from_slice(&tick.to_le_bytes());
    });
    Floor::load(ruleset, &forged).err()
}

#[test]
fn clock_before_the_round_is_corrupt() {
    assert_eq!(
        load_with_clock(TICKS_PER_ROUND - 1),
        Some(corrupt("clock out of range"))
    );
}

#[test]
fn clocks_at_the_round_start_and_one_maximal_cost_after_load() {
    assert_eq!(load_with_clock(TICKS_PER_ROUND), None);
    assert_eq!(load_with_clock(TICKS_PER_ROUND + u64::from(u32::MAX)), None);
}

#[test]
fn clock_past_one_maximal_cost_is_corrupt() {
    let past = TICKS_PER_ROUND + u64::from(u32::MAX) + 1;
    assert_eq!(load_with_clock(past), Some(corrupt("clock out of range")));
}
