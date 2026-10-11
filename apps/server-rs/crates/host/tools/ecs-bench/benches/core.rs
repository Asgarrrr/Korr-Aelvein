//! One round of the reference world: a 128x128 floor with 8k actors and 2k
//! things. The budget is about 200 ns per entity.

use criterion::{Criterion, Throughput, criterion_group, criterion_main};
use korr_core::host::{Game, Mechanics, Pos, Seed, World};
use korr_ecs::FloorId;
use korr_engine::Registry;
use korr_scenarios::{Shy, floor, game};

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

fn world<M: Mechanics>(mechanics: M) -> (World, Game<M>) {
    let game = game(mechanics, Seed(1));
    let mut f = floor(game.ruleset(), FloorId(0), SIDE, SIDE);
    for k in 0..ACTORS {
        f.spawn_actor(game.ruleset(), spread(k, ACTORS));
    }
    for k in 0..THINGS {
        f.spawn_thing(spread(k, THINGS));
    }
    (World::new(vec![f]), game)
}

fn round(
    group: &mut criterion::BenchmarkGroup<'_, criterion::measurement::WallTime>,
    name: &str,
    mechanics: impl Mechanics,
) {
    let (mut world, game) = world(mechanics);
    group.bench_function(name, |b| b.iter(|| game.run_round(&mut world)));
}

fn core(c: &mut Criterion) {
    let mut group = c.benchmark_group("round_8k_2k");
    group.throughput(Throughput::Elements(u64::from(ACTORS + THINGS)));
    round(&mut group, "wander", Registry::default());
    round(&mut group, "perceiving", Shy);
    group.finish();
}

criterion_group!(benches, core);
criterion_main!(benches);
