//! One round of the reference world: a 128x128 floor with 8k actors and 2k
//! things. The budget, about 200 ns per entity, holds for wander, which also
//! walks flora's bare column; perceiving prices sight with every actor looking,
//! at half density. The sweep repeats the round at other sizes and densities,
//! so a gain is not one point's luck. The flora sweep prices the environment
//! phase alone per interior cell, budget 5 ns, from ripe plants beside bare ground.

use criterion::{BatchSize, BenchmarkId, Criterion, Throughput, criterion_group, criterion_main};
use korr_core::host::{Game, Mechanics, Pos, Seed, World};
use korr_ecs::FloorId;
use korr_engine::Registry;
use korr_flora::Flora;
use korr_scenarios::{Shy, floor, game};

#[derive(Debug, Clone, Copy)]
struct Layout {
    side: u16,
    actors: u32,
    things: u32,
}

const REFERENCE: Layout = Layout {
    side: 128,
    actors: 8_000,
    things: 2_000,
};
const SIDES: [u16; 3] = [64, 128, 256];
const SIZE_FILL: u32 = 50;
const FILLS: [u32; 2] = [10, 90];

impl Layout {
    /// `percent` of the interior holds an actor, and a quarter as many things.
    fn filled(side: u16, percent: u32) -> Self {
        let inside = u32::from(side - 2);
        let actors = inside * inside * percent / 100;
        Self {
            side,
            actors,
            things: actors / 4,
        }
    }

    fn entities(self) -> u64 {
        u64::from(self.actors + self.things)
    }

    fn world<M: Mechanics>(self, mechanics: M) -> (World, Game<M>) {
        let game = game(mechanics, Seed(1));
        let mut f = floor(game.ruleset(), FloorId(0), self.side, self.side);
        for k in 0..self.actors {
            f.spawn_actor(game.ruleset(), spread(self.side, k, self.actors));
        }
        for k in 0..self.things {
            f.spawn_thing(spread(self.side, k, self.things));
        }
        (World::new(vec![f]), game)
    }
}

/// The `k`-th of `n` cells spread evenly over the interior, row-major.
fn spread(side: u16, k: u32, n: u32) -> Pos {
    let inside = u64::from(side - 2);
    let cell = u64::from(k) * inside * inside / u64::from(n);
    let coord = |v: u64| i16::try_from(v + 1).expect("an interior coordinate fits i16");
    Pos {
        x: coord(cell % inside),
        y: coord(cell / inside),
    }
}

type Group<'a> = criterion::BenchmarkGroup<'a, criterion::measurement::WallTime>;

fn round(group: &mut Group<'_>, id: BenchmarkId, layout: Layout, mechanics: impl Mechanics) {
    let (mut world, game) = layout.world(mechanics);
    group.throughput(Throughput::Elements(layout.entities()));
    group.bench_function(id, |b| b.iter(|| game.run_round(&mut world)));
}

fn core(c: &mut Criterion) {
    let mut group = c.benchmark_group("round_8k_2k");
    round(
        &mut group,
        BenchmarkId::from_parameter("wander"),
        REFERENCE,
        Registry::default(),
    );
    round(
        &mut group,
        BenchmarkId::from_parameter("perceiving"),
        REFERENCE,
        Shy,
    );
    group.finish();
}

fn sweep(c: &mut Criterion) {
    let layouts = SIDES
        .map(|side| Layout::filled(side, SIZE_FILL))
        .into_iter()
        .chain(FILLS.map(|fill| Layout::filled(REFERENCE.side, fill)));
    let mut group = c.benchmark_group("round_sweep");
    for layout in layouts {
        let case = format!(
            "{}x{}_{}a_{}t",
            layout.side, layout.side, layout.actors, layout.things
        );
        round(
            &mut group,
            BenchmarkId::new("wander", &case),
            layout,
            Registry::default(),
        );
        round(
            &mut group,
            BenchmarkId::new("perceiving", &case),
            layout,
            Shy,
        );
    }
    group.finish();
}

fn planted(game: &Game<Registry>, world: &World, side: u16) -> u32 {
    let last = side.cast_signed() - 2;
    let f = world.floor(FloorId(0));
    (1..=last)
        .flat_map(|y| (1..=last).map(move |x| Pos { x, y }))
        .map(|at| u32::from(f.cell_value::<Flora>(game.ruleset(), at) != 0))
        .sum()
}

fn flora_sweep(c: &mut Criterion) {
    let cases = SIDES
        .map(|side| (side, SIZE_FILL))
        .into_iter()
        .chain(FILLS.map(|fill| (REFERENCE.side, fill)));
    let mut group = c.benchmark_group("flora_sweep");
    for (side, percent) in cases {
        let game = game(
            Registry {
                wander: None,
                ..Registry::default()
            },
            Seed(1),
        );
        let inside = u32::from(side - 2);
        let plants = inside * inside * percent / 100;
        let mut f = floor(game.ruleset(), FloorId(0), side, side);
        for k in 0..plants {
            f.set_cell_value::<Flora>(game.ruleset(), spread(side, k, plants), u8::MAX);
        }
        let bytes = game.save(&World::new(vec![f]));
        let mut sown = game.load(&bytes).expect("own save loads");
        game.run_round(&mut sown);
        // A round that seeds nothing would time the walk without a single draw.
        assert!(
            planted(&game, &sown, side) > plants,
            "one round seeds bare ground"
        );
        group.throughput(Throughput::Elements(u64::from(inside * inside)));
        group.bench_function(
            BenchmarkId::new("flora", format!("{side}x{side}_{percent}pct")),
            |b| {
                b.iter_batched(
                    || game.load(&bytes).expect("own save loads"),
                    |mut world| {
                        game.run_round(&mut world);
                        world
                    },
                    BatchSize::LargeInput,
                );
            },
        );
    }
    group.finish();
}

criterion_group!(benches, core, sweep, flora_sweep);
criterion_main!(benches);
