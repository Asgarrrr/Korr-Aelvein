//! One round of the reference world: a 128x128 floor with 8k actors and 2k
//! things. The budget is about 200 ns per entity.

use criterion::{Criterion, Throughput, criterion_group, criterion_main};
use korr_core::{Mechanics, Pos, Ruleset, Seed, World};
use korr_ecs::SchemaBuilder;
use korr_engine::Registry;
use korr_scenarios::{Shy, floor};

const SIDE: u16 = 128;
const INSIDE: u32 = 126;
const ACTORS: u32 = 8_000;
const THINGS: u32 = 2_000;

/// The `k`-th of `n` cells spread evenly over the interior, row-major.
fn spread(k: u32, n: u32) -> Pos {
    let cell = k * (INSIDE * INSIDE) / n;
    let coord = |v: u32| i16::try_from(v + 1).expect("an interior coordinate fits i16");
    Pos {
        x: coord(cell % INSIDE),
        y: coord(cell / INSIDE),
    }
}

fn world(mechanics: &impl Mechanics) -> (World, Ruleset) {
    let ruleset = Ruleset::new(SchemaBuilder::default(), mechanics);
    let mut f = floor(&ruleset, 0, SIDE, SIDE);
    for k in 0..ACTORS {
        f.spawn_actor(&ruleset, spread(k, ACTORS));
    }
    for k in 0..THINGS {
        f.spawn_thing(spread(k, THINGS));
    }
    (World::new(Seed(1), vec![f]), ruleset)
}

fn round(
    group: &mut criterion::BenchmarkGroup<'_, criterion::measurement::WallTime>,
    name: &str,
    mechanics: &impl Mechanics,
) {
    let (mut world, ruleset) = world(mechanics);
    group.bench_function(name, |b| b.iter(|| world.run_round(&ruleset, mechanics)));
}

fn core(c: &mut Criterion) {
    let mut group = c.benchmark_group("round_8k_2k");
    group.throughput(Throughput::Elements(u64::from(ACTORS + THINGS)));
    round(&mut group, "wander", &Registry::default());
    round(&mut group, "perceiving", &Shy);
    group.finish();
}

criterion_group!(benches, core);
criterion_main!(benches);
