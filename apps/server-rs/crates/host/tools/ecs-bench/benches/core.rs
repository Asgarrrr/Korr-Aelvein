//! One round of the reference world: a 128x128 floor with 8k actors and 2k
//! things. The budget, about 200 ns per entity, holds for wander; perceiving
//! prices sight with every actor looking, at half density. The sweep repeats
//! the round at other sizes and densities, so a gain is not one point's luck.

use criterion::{BenchmarkId, Criterion, Throughput, criterion_group, criterion_main};
use korr_core::host::{Game, Mechanics, Pos, Seed, World};
use korr_ecs::FloorId;
use korr_engine::Registry;
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

    /// The `k`-th of `n` cells spread evenly over the interior, row-major.
    fn spread(self, k: u32, n: u32) -> Pos {
        let inside = u64::from(self.side - 2);
        let cell = u64::from(k) * inside * inside / u64::from(n);
        let coord = |v: u64| i16::try_from(v + 1).expect("an interior coordinate fits i16");
        Pos {
            x: coord(cell % inside),
            y: coord(cell / inside),
        }
    }

    fn world<M: Mechanics>(self, mechanics: M) -> (World, Game<M>) {
        let game = game(mechanics, Seed(1));
        let mut f = floor(game.ruleset(), FloorId(0), self.side, self.side);
        for k in 0..self.actors {
            f.spawn_actor(game.ruleset(), self.spread(k, self.actors));
        }
        for k in 0..self.things {
            f.spawn_thing(self.spread(k, self.things));
        }
        (World::new(vec![f]), game)
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

criterion_group!(benches, core, sweep);
criterion_main!(benches);
