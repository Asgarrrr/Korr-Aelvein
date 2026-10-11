use crate::driver::World;

/// The 5x5 floor has 9 interior cells: it fills up and refuses arrivals.
const FLOORS: [(u16, u16); 3] = [(12, 9), (7, 15), (5, 5)];

fn travel(seed: u64) {
    let mut world = World::new(seed, &FLOORS);
    for _ in 0..100 {
        world.run(1_000);
        world.check();
        world.reload();
        world.check();
    }
}

#[test]
fn travel_seed_1() {
    travel(1);
}

#[test]
fn travel_seed_2() {
    travel(2);
}

#[test]
fn travel_seed_3() {
    travel(3);
}
