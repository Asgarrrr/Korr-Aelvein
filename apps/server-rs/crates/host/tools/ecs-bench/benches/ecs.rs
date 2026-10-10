use std::hint::black_box;

use criterion::measurement::WallTime;
use criterion::{BenchmarkGroup, Criterion, Throughput, criterion_group, criterion_main};
use korr_ecs_bench::bevy_world::BevyWorld;
use korr_ecs_bench::dense::Dense;
use korr_ecs_bench::hecs_world::HecsWorld;
use korr_ecs_bench::ours::Ours;
use korr_ecs_bench::{Backend, picks};

const N: u32 = 20_000;
const K: u32 = 1_000;

#[derive(Clone, Copy)]
enum Op {
    Churn,
    ActorTurn,
    Bulk,
    Query,
    Travel,
}

impl Op {
    fn apply<B: Backend>(self, backend: &mut B, picks: &[u32]) -> u64 {
        match self {
            Self::Churn => backend.churn(picks),
            Self::ActorTurn => return backend.actor_turn(picks),
            Self::Bulk => backend.bulk(),
            Self::Query => backend.query(),
            Self::Travel => backend.travel(picks),
        }
        0
    }
}

fn measure<B: Backend>(group: &mut BenchmarkGroup<'_, WallTime>, picks: &[u32], op: Op) {
    let mut backend = B::populate(N);
    group.bench_function(B::NAME, |b| {
        b.iter(|| black_box(op.apply(&mut backend, black_box(picks))));
    });
}

fn workload(c: &mut Criterion, name: &str, elements: u32, op: Op) {
    let picks = picks(1, N, K);
    let mut group = c.benchmark_group(name);
    group.throughput(Throughput::Elements(u64::from(elements)));
    measure::<Ours>(&mut group, &picks, op);
    measure::<HecsWorld>(&mut group, &picks, op);
    measure::<BevyWorld>(&mut group, &picks, op);
    measure::<Dense>(&mut group, &picks, op);
    group.finish();
}

fn churn(c: &mut Criterion) {
    workload(c, "churn", K, Op::Churn);
}

fn actor_turn(c: &mut Criterion) {
    workload(c, "actor_turn", K, Op::ActorTurn);
}

fn bulk(c: &mut Criterion) {
    workload(c, "bulk", N, Op::Bulk);
}

fn query(c: &mut Criterion) {
    workload(c, "query", N, Op::Query);
}

fn travel(c: &mut Criterion) {
    workload(c, "travel", K, Op::Travel);
}

criterion_group!(benches, churn, actor_turn, bulk, query, travel);
criterion_main!(benches);
