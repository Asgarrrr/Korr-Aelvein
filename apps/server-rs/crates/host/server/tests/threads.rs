use core::num::NonZeroUsize;

use korr_core::host::{Pos, Runner, Seed, Sequential, Vitality, World};
use korr_ecs::FloorId;
use korr_engine::Registry;
use korr_hunger::Diet;
use korr_scenarios::{Pace, TO_GROUND, floor, game, grounded, hunger, plants, run_on, stomach};
use korr_server::Threads;

const SEED: Seed = Seed(5);

#[test]
fn every_thread_count_gives_the_sequential_hash() {
    let expected = (grounded(&Sequential), meadows(&Sequential));
    let host = std::thread::available_parallelism().expect("the host reports its parallelism");
    let counts = [1, 2, 3].map(|n| NonZeroUsize::new(n).expect("a positive count"));
    for n in counts.into_iter().chain([host]) {
        let threads = Threads::new(n).expect("the pool builds");
        assert_eq!(
            (grounded(&threads), meadows(&threads)),
            expected,
            "{n} threads"
        );
    }
}

/// The hash of six meadows after 30 rounds on `runner`, where creatures
/// graze or starve and leave remains.
fn meadows(runner: &impl Runner) -> u64 {
    let game = game(Registry::default(), SEED);
    let ruleset = game.ruleset();
    let floors = (0..6_i16)
        .map(|id| {
            let mut f = floor(ruleset, FloorId(id.cast_unsigned()), 12, 12);
            for k in 0..4 {
                let at = Pos {
                    x: 2 + 2 * k,
                    y: 2 + k,
                };
                f.set_cell(ruleset, plants(game.mechanics()), at, u8::MAX);
            }
            for k in 0..10 {
                let at = Pos {
                    x: 1 + k,
                    y: 1 + (k * 7 + id) % 10,
                };
                let h = f.spawn_actor(ruleset, at);
                stomach(&mut f, hunger(game.mechanics()), h, 0, Diet::ALL);
                f.init(ruleset.vitality(), h, Vitality { hp: 12, max: 4 });
            }
            f
        })
        .collect();
    let mut world = World::new(floors);
    run_on(&game, &mut world, 30, runner);
    game.hash(&world)
}

#[test]
#[should_panic(expected = "ruleset is not the one that built this floor")]
fn a_floor_panic_reaches_the_caller() {
    let ground = game(TO_GROUND, SEED);
    let paced = game(Pace, SEED);
    let mut world = World::new(vec![
        floor(ground.ruleset(), FloorId(0), 5, 5),
        floor(paced.ruleset(), FloorId(1), 5, 5),
    ]);
    let two = NonZeroUsize::new(2).expect("a positive count");
    ground.run_round_on(&mut world, &Threads::new(two).expect("the pool builds"));
}
