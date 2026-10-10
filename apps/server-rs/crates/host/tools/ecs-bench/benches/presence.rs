//! Sparse set against dense columns on the population the mechanics will
//! make: 30 components, two on every entity, the other 28 on about 7% each.

use std::hint::black_box;

use criterion::{Criterion, Throughput, criterion_group, criterion_main};
use korr_ecs::{
    Component, ComponentKey, FloorId, Handle, ImageError, Reader, SchemaBuilder, Store, Writer,
};
use korr_ecs_bench::picks;

const N: u32 = 20_000;
const K: u32 = 1_000;
const COLUMNS: usize = 30;
const ALWAYS: usize = 2;
const PERCENT: u64 = 7;
const NAMES: [&str; COLUMNS] = [
    "c00", "c01", "c02", "c03", "c04", "c05", "c06", "c07", "c08", "c09", "c10", "c11", "c12",
    "c13", "c14", "c15", "c16", "c17", "c18", "c19", "c20", "c21", "c22", "c23", "c24", "c25",
    "c26", "c27", "c28", "c29",
];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct Field(u32);

impl Component for Field {
    fn write(&self, w: &mut Writer) {
        w.write_u32(self.0);
    }

    fn read(r: &mut Reader<'_>) -> Result<Self, ImageError> {
        r.read_u32().map(Self)
    }
}

fn has(i: u32, column: usize) -> bool {
    if column < ALWAYS {
        return true;
    }
    let mut z = (u64::from(i) << 8 | column as u64).wrapping_add(0x9e37_79b9_7f4a_7c15);
    z = (z ^ (z >> 30)).wrapping_mul(0xbf58_476d_1ce4_e5b9);
    z = (z ^ (z >> 27)).wrapping_mul(0x94d0_49bb_1331_11eb);
    (z ^ (z >> 31)) % 100 < PERCENT
}

trait Backend {
    fn populate() -> Self;
    fn churn(&mut self, picks: &[u32]);
    fn actor_turn(&mut self, picks: &[u32]) -> u64;
    fn bulk(&mut self, column: usize);
    fn query(&mut self) -> u64;
}

struct Ours {
    store: Store,
    keys: Vec<ComponentKey<Field>>,
    index: Vec<Handle>,
}

impl Ours {
    fn spawn(&mut self, values: &[Option<Field>; COLUMNS]) -> Handle {
        let h = self.store.spawn();
        for (key, value) in self.keys.iter().zip(values) {
            if let Some(v) = value {
                self.store.insert(*key, h, *v);
            }
        }
        h
    }
}

impl Backend for Ours {
    fn populate() -> Self {
        let mut builder = SchemaBuilder::default();
        let keys = NAMES
            .iter()
            .map(|name| builder.register::<Field>(name))
            .collect();
        let schema = builder.build();
        let mut ours = Self {
            store: Store::new(&schema, FloorId(0)),
            keys,
            index: Vec::new(),
        };
        for i in 0..N {
            let values = core::array::from_fn(|c| has(i, c).then_some(Field(i)));
            let h = ours.spawn(&values);
            ours.index.push(h);
        }
        ours
    }

    fn churn(&mut self, picks: &[u32]) {
        for &p in picks {
            let h = self.index[p as usize];
            let values = core::array::from_fn(|c| self.store.get(self.keys[c], h).copied());
            self.store.despawn(h);
            self.index[p as usize] = self.spawn(&values);
        }
    }

    fn actor_turn(&mut self, picks: &[u32]) -> u64 {
        let mut sum = 0_u64;
        for &p in picks {
            let h = self.index[p as usize];
            sum = sum.wrapping_add(u64::from(
                self.store.get(self.keys[0], h).expect("always present").0,
            ));
            for key in &self.keys[ALWAYS..ALWAYS + 4] {
                sum = sum.wrapping_add(u64::from(self.store.get(*key, h).map_or(0, |f| f.0)));
            }
            let need = self.store.get_mut(self.keys[1], h).expect("always present");
            need.0 = need.0.saturating_sub(1);
        }
        sum
    }

    fn bulk(&mut self, column: usize) {
        for f in self.store.values_mut(self.keys[column]) {
            f.0 = f.0.saturating_sub(1);
        }
    }

    fn query(&mut self) -> u64 {
        let mut sum = 0_u64;
        self.store
            .join_mut(self.keys[ALWAYS], self.keys[ALWAYS + 1], |_, a, b| {
                b.0 = b.0.wrapping_add(a.0);
                sum = sum.wrapping_add(u64::from(b.0));
            });
        sum
    }
}

#[derive(Clone, Copy)]
struct Slot {
    index: u32,
    generation: u32,
}

struct Dense {
    generations: Vec<u32>,
    free: Vec<u32>,
    columns: Vec<Vec<Option<Field>>>,
    index: Vec<Slot>,
}

impl Dense {
    fn spawn(&mut self, values: &[Option<Field>; COLUMNS]) -> Slot {
        let index = self.free.pop().unwrap_or_else(|| {
            self.generations.push(0);
            for column in &mut self.columns {
                column.push(None);
            }
            u32::try_from(self.generations.len() - 1).expect("fewer than 2^32 slots")
        });
        let at = index as usize;
        for (column, value) in self.columns.iter_mut().zip(values) {
            column[at] = *value;
        }
        Slot {
            index,
            generation: self.generations[at],
        }
    }

    fn at(&self, s: Slot) -> usize {
        assert_eq!(
            self.generations[s.index as usize], s.generation,
            "stale slot"
        );
        s.index as usize
    }
}

impl Backend for Dense {
    fn populate() -> Self {
        let mut dense = Self {
            generations: Vec::new(),
            free: Vec::new(),
            columns: vec![Vec::new(); COLUMNS],
            index: Vec::new(),
        };
        for i in 0..N {
            let values = core::array::from_fn(|c| has(i, c).then_some(Field(i)));
            let s = dense.spawn(&values);
            dense.index.push(s);
        }
        dense
    }

    fn churn(&mut self, picks: &[u32]) {
        for &p in picks {
            let s = self.index[p as usize];
            let at = self.at(s);
            let values = core::array::from_fn(|c| self.columns[c][at].take());
            self.generations[at] += 1;
            self.free.push(s.index);
            self.index[p as usize] = self.spawn(&values);
        }
    }

    fn actor_turn(&mut self, picks: &[u32]) -> u64 {
        let mut sum = 0_u64;
        for &p in picks {
            let at = self.at(self.index[p as usize]);
            sum = sum.wrapping_add(u64::from(self.columns[0][at].expect("always present").0));
            for column in &self.columns[ALWAYS..ALWAYS + 4] {
                sum = sum.wrapping_add(u64::from(column[at].map_or(0, |f| f.0)));
            }
            let need = self.columns[1][at].as_mut().expect("always present");
            need.0 = need.0.saturating_sub(1);
        }
        sum
    }

    fn bulk(&mut self, column: usize) {
        for f in self.columns[column].iter_mut().flatten() {
            f.0 = f.0.saturating_sub(1);
        }
    }

    fn query(&mut self) -> u64 {
        let mut sum = 0_u64;
        let [a, b] = self
            .columns
            .get_disjoint_mut([ALWAYS, ALWAYS + 1])
            .expect("two distinct columns");
        for (a, b) in a.iter().zip(b.iter_mut()) {
            if let (Some(a), Some(b)) = (a, b) {
                b.0 = b.0.wrapping_add(a.0);
                sum = sum.wrapping_add(u64::from(b.0));
            }
        }
        sum
    }
}

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
