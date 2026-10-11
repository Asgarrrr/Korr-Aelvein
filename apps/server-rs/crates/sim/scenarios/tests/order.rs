use korr_core::host::{Floor, Job, Runner, Sequential};
use korr_scenarios::grounded;

struct Reversed;

impl Runner for Reversed {
    fn each<F: Fn(&mut Floor) + Sync>(&self, jobs: Vec<Job<'_, F>>) {
        jobs.into_iter().rev().for_each(Job::run);
    }
}

struct Halt;

impl Runner for Halt {
    fn each<F: Fn(&mut Floor) + Sync>(&self, _: Vec<Job<'_, F>>) {}
}

#[test]
fn reversed_floor_order_gives_the_sequential_hash() {
    let sequential = grounded(&Sequential);
    assert!(sequential.waiting > 0, "travellers wait in floor 0's inbox");
    assert_eq!(grounded(&Reversed), sequential);
}

#[test]
fn phase_one_runs_through_the_runner() {
    assert_ne!(grounded(&Halt).hash, grounded(&Sequential).hash);
}
