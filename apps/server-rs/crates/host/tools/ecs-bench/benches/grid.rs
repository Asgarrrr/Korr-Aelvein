//! Occupancy of one 66x66 floor: the "actor here?" probe and a step there and back.

use std::hint::black_box;

use criterion::{Criterion, Throughput, criterion_group, criterion_main};
use korr_ecs::{FloorId, Handle, SchemaBuilder, Store};
use korr_ecs_bench::picks;
use korr_grid::{CellIdx, Dir, Grid, Interior, Pos, Shape};

const SIDE: u16 = 66;
const INSIDE: u32 = 64;
const ACTORS: u32 = 1024;
const K: u32 = 4096;

fn interior(shape: Shape, pick: u32) -> Interior {
    let coord = |v: u32| i16::try_from(v + 1).expect("an interior coordinate fits i16");
    shape
        .idx(Pos {
            x: coord(pick % INSIDE),
            y: coord(pick / INSIDE),
        })
        .expect("the pick is inside")
}

fn populate(shape: Shape) -> (Grid, Vec<Handle>) {
    let mut store = Store::new(&SchemaBuilder::default().build(), FloorId(0));
    let mut grid = Grid::new(shape);
    let mut actors = Vec::new();
    for pick in picks(1, INSIDE * INSIDE, ACTORS) {
        let at = interior(shape, pick);
        if grid.actor_at(at.cell()).is_none() {
            let h = store.spawn();
            grid.link_actor(&store, h, at);
            actors.push(h);
        }
    }
    (grid, actors)
}

fn grid(c: &mut Criterion) {
    let shape = Shape::new(SIDE, SIDE).expect("66x66 fits the bounds");
    let (mut grid, actors) = populate(shape);
    let cells: Vec<CellIdx> = picks(2, INSIDE * INSIDE, K)
        .into_iter()
        .map(|pick| interior(shape, pick).cell())
        .collect();
    let count = u32::try_from(actors.len()).expect("fewer than 2^32 actors");
    let steppers: Vec<Handle> = picks(3, count, K)
        .into_iter()
        .map(|pick| actors[pick as usize])
        .collect();

    let mut group = c.benchmark_group("grid");
    group.throughput(Throughput::Elements(u64::from(K)));
    group.bench_function("actor_at", |b| {
        b.iter(|| {
            black_box(
                black_box(&cells)
                    .iter()
                    .filter(|&&at| grid.actor_at(at).is_some())
                    .count(),
            )
        });
    });
    group.bench_function("step", |b| {
        b.iter(|| {
            let mut moved = 0_u32;
            for &h in black_box(&steppers) {
                if grid.step(h, Dir::East).is_ok() {
                    grid.step(h, Dir::West)
                        .expect("the cell it left is still free");
                    moved += 1;
                }
            }
            black_box(moved)
        });
    });
    group.finish();
}

criterion_group!(benches, grid);
criterion_main!(benches);
