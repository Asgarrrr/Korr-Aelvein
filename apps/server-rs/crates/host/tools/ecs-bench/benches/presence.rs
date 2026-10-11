//! Sparse set against dense columns: the backends live in `presence`, so the
//! equivalence test runs them under `verify`.

use std::hint::black_box;

use criterion::{Criterion, Throughput, criterion_group, criterion_main};
use korr_ecs_bench::picks;
use korr_ecs_bench::presence::{ALWAYS, Backend, Dense, K, N, Ours};

fn group<F: Fn(&mut Ours) -> u64, G: Fn(&mut Dense) -> u64>(
    c: &mut Criterion,
    name: &str,
    elements: u32,
    ours: F,
    dense: G,
) {
    let mut group = c.benchmark_group(name);
    group.throughput(Throughput::Elements(u64::from(elements)));
    let mut o = Ours::populate();
    group.bench_function("ours", |b| b.iter(|| black_box(ours(&mut o))));
    let mut d = Dense::populate();
    group.bench_function("dense", |b| b.iter(|| black_box(dense(&mut d))));
    group.finish();
}

fn presence(c: &mut Criterion) {
    let picks = picks(1, N, K);
    let p = &picks;
    group(
        c,
        "presence/churn",
        K,
        |o| {
            o.churn(black_box(p));
            0
        },
        |d| {
            d.churn(black_box(p));
            0
        },
    );
    group(
        c,
        "presence/actor_turn",
        K,
        |o| o.actor_turn(black_box(p)),
        |d| d.actor_turn(black_box(p)),
    );
    group(
        c,
        "presence/bulk_full",
        N,
        |o| {
            o.bulk(1);
            0
        },
        |d| {
            d.bulk(1);
            0
        },
    );
    // Per floor entity, not per row: dense scans every slot whatever the fill.
    group(
        c,
        "presence/bulk_sparse",
        N,
        |o| {
            o.bulk(ALWAYS);
            0
        },
        |d| {
            d.bulk(ALWAYS);
            0
        },
    );
    group(c, "presence/query_sparse", N, Ours::query, Dense::query);
}

criterion_group!(benches, presence);
criterion_main!(benches);
