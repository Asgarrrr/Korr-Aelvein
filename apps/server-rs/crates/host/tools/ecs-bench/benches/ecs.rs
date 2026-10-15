use std::collections::BTreeMap;
use std::hint::black_box;

use criterion::measurement::WallTime;
use criterion::{BenchmarkGroup, Criterion, Throughput, criterion_group, criterion_main};
use korr_ecs::{EntityId, FloorId, Handle, SchemaBuilder, Store};
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

/// `N` entities, then `K` despawns each followed by a spawn: the live ids
/// leave gaps, as on a floor that has run a while.
fn churned() -> (Store, Vec<EntityId>) {
    let mut store = Store::new(&SchemaBuilder::default().build(), FloorId(0));
    let mut handles: Vec<Handle> = (0..N).map(|_| store.spawn()).collect();
    for p in picks(2, N, K) {
        store.despawn(handles[p as usize]);
        handles[p as usize] = store.spawn();
    }
    let ids = handles
        .iter()
        .map(|&h| store.id(h).expect("every kept handle is alive"))
        .collect();
    (store, ids)
}

fn slot_sum(found: impl Iterator<Item = Handle>) -> u64 {
    found.map(|h| u64::from(h.slot().get())).sum()
}

/// `Store::handle_of` against the ordered map it replaces, on the same `K` ids.
fn id_index(c: &mut Criterion) {
    let (store, ids) = churned();
    let map: BTreeMap<EntityId, Handle> = ids
        .iter()
        .map(|&id| (id, store.handle_of(id).expect("every kept id is indexed")))
        .collect();
    let lookups: Vec<EntityId> = picks(1, N, K).iter().map(|&p| ids[p as usize]).collect();
    let mut group = c.benchmark_group("id_index");
    group.throughput(Throughput::Elements(u64::from(K)));
    group.bench_function("handle_of", |b| {
        b.iter(|| {
            let store = black_box(&store);
            slot_sum(lookups.iter().filter_map(|&id| store.handle_of(id)))
        });
    });
    group.bench_function("btreemap", |b| {
        b.iter(|| {
            let map = black_box(&map);
            slot_sum(lookups.iter().filter_map(|id| map.get(id).copied()))
        });
    });
    group.finish();
}

criterion_group!(benches, churn, actor_turn, bulk, query, travel, id_index);
criterion_main!(benches);
