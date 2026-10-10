use crate::driver::World;

fn churn(seed: u64) {
    let mut world = World::new(seed, 1);
    for _ in 0..100 {
        world.run(1_000);
        world.check();
    }
}

#[test]
fn churn_seed_1() {
    churn(1);
}

#[test]
fn churn_seed_2() {
    churn(2);
}

#[test]
fn churn_seed_3() {
    churn(3);
}
