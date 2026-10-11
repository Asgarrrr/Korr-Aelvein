use core::num::NonZeroUsize;

use korr_core::host::{Seed, Sequential, World};
use korr_ecs::FloorId;
use korr_scenarios::{Pace, TO_GROUND, floor, game, grounded};
use korr_server::Threads;

const SEED: Seed = Seed(5);

#[test]
fn every_thread_count_gives_the_sequential_hash() {
    let expected = grounded(&Sequential);
    let host = std::thread::available_parallelism().expect("the host reports its parallelism");
    let counts = [1, 2, 3].map(|n| NonZeroUsize::new(n).expect("a positive count"));
    for n in counts.into_iter().chain([host]) {
        let threads = Threads::new(n).expect("the pool builds");
        assert_eq!(grounded(&threads), expected, "{n} threads");
    }
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
