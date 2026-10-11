use korr_core::host::{Floor, Runner, Seed, Sequential};
use korr_ecs::FloorId;
use korr_scenarios::{TO_GROUND, game, run_on, tower};

const SEED: Seed = Seed(5);
const ROUNDS: u64 = 3;

struct Reversed;

impl Runner for Reversed {
    fn each<F: Fn(&mut Floor) + Sync + Send>(&self, floors: &mut [Floor], f: F) {
        floors.iter_mut().rev().for_each(f);
    }
}

struct Halt;

impl Runner for Halt {
    fn each<F: Fn(&mut Floor) + Sync + Send>(&self, _: &mut [Floor], _: F) {}
}

fn after(runner: &impl Runner) -> (u64, usize) {
    let game = game(TO_GROUND, SEED);
    let mut world = tower(game.ruleset());
    run_on(&game, &mut world, ROUNDS, runner);
    (game.hash(&world), world.floor(FloorId(0)).inbox_len())
}

#[test]
fn reversed_floor_order_gives_the_sequential_hash() {
    let (sequential, waiting) = after(&Sequential);
    assert!(waiting > 0, "travellers wait in floor 0's inbox");
    assert_eq!(after(&Reversed).0, sequential);
}

#[test]
fn phase_one_runs_through_the_runner() {
    assert_ne!(after(&Halt).0, after(&Sequential).0);
}
