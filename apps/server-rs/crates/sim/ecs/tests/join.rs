use std::collections::BTreeMap;
use std::num::NonZeroU32;

use korr_ecs::{
    Component, ComponentKey, EntityId, FloorId, Handle, ImageError, Reader, SchemaBuilder, Store,
    Writer,
};
use korr_random::{DrawIndex, ModuleKey, Phase, Seed, Stream, Subject};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct A(u32);

impl Component for A {
    fn write(&self, w: &mut Writer) {
        w.write_u32(self.0);
    }

    fn read(r: &mut Reader<'_>) -> Result<Self, ImageError> {
        r.read_u32().map(Self)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct B(u32);

impl Component for B {
    fn write(&self, w: &mut Writer) {
        w.write_u32(self.0);
    }

    fn read(r: &mut Reader<'_>) -> Result<Self, ImageError> {
        r.read_u32().map(Self)
    }
}

type Row = (Option<u32>, Option<u32>);

struct Fixture {
    store: Store,
    a: ComponentKey<A>,
    b: ComponentKey<B>,
    model: BTreeMap<EntityId, Row>,
}

fn fixture() -> Fixture {
    let mut builder = SchemaBuilder::default();
    let a = builder.register::<A>("a");
    let b = builder.register::<B>("b");
    let mut store = Store::new(&builder.build(), FloorId(0));
    let stream = Stream::new(Seed(7), ModuleKey::of("ecs-join"), Phase::Spawn, 0);
    let range = NonZeroU32::new(1_000).expect("not zero");
    let mut model = BTreeMap::new();
    let mut handles = Vec::new();
    for i in 0..2_000_u64 {
        let h = store.spawn();
        let id = store.id(h).expect("a spawned handle is alive");
        let subject = Subject::Entity(id.to_bits());
        let mut row: Row = (None, None);
        if i % 2 == 0 {
            let value = stream.below(subject, DrawIndex(0), range);
            store.insert(a, h, A(value));
            row.0 = Some(value);
        }
        if i % 3 == 0 {
            let value = stream.below(subject, DrawIndex(1), range);
            store.insert(b, h, B(value));
            row.1 = Some(value);
        }
        model.insert(id, row);
        handles.push((h, id));
    }
    for (i, &(h, id)) in handles.iter().enumerate() {
        if i % 7 == 0 {
            store.despawn(h);
            model.remove(&id);
        } else if i % 11 == 0 && store.remove(a, h).is_some() {
            model.get_mut(&id).expect("model holds live rows").0 = None;
        }
    }
    Fixture { store, a, b, model }
}

fn id_of(store: &Store, h: Handle) -> EntityId {
    store.id(h).expect("a join yields live handles")
}

#[test]
fn join_yields_exactly_rows_with_both() {
    let f = fixture();
    let joined: BTreeMap<EntityId, (u32, u32)> = f
        .store
        .join(f.a, f.b)
        .map(|(h, a, b)| (id_of(&f.store, h), (a.0, b.0)))
        .collect();
    let expected: BTreeMap<EntityId, (u32, u32)> = f
        .model
        .iter()
        .filter_map(|(&id, &(a, b))| Some((id, (a?, b?))))
        .collect();
    assert!(expected.len() > 100);
    assert_eq!(joined.len(), f.store.join(f.a, f.b).count());
    assert_eq!(joined, expected);
}

#[test]
fn join_order_is_the_first_keys_dense_order() {
    let f = fixture();
    let expected: Vec<Handle> = f
        .store
        .iter(f.a)
        .map(|(h, _)| h)
        .filter(|&h| f.store.get(f.b, h).is_some())
        .collect();
    let joined: Vec<Handle> = f.store.join(f.a, f.b).map(|(h, _, _)| h).collect();
    assert!(expected.len() > 100);
    assert_eq!(joined, expected);
}

#[test]
fn join_mut_touches_only_rows_with_both() {
    let mut f = fixture();
    let mut touched = Vec::new();
    f.store.join_mut(f.a, f.b, |h, a, b| {
        a.0 += b.0;
        touched.push(h);
    });

    let touched_ids: Vec<EntityId> = touched.iter().map(|&h| id_of(&f.store, h)).collect();
    let expected_ids: Vec<EntityId> = f
        .store
        .iter(f.a)
        .map(|(h, _)| id_of(&f.store, h))
        .filter(|id| f.model[id].1.is_some())
        .collect();
    assert!(expected_ids.len() > 100);
    assert_eq!(touched_ids, expected_ids);

    let a_after: BTreeMap<EntityId, u32> = f
        .store
        .iter(f.a)
        .map(|(h, v)| (id_of(&f.store, h), v.0))
        .collect();
    for (&id, &(a, b)) in &f.model {
        assert_eq!(
            a_after.get(&id).copied(),
            a.map(|a| a + b.unwrap_or(0)),
            "{id:?}"
        );
    }
    for (h, value) in f.store.iter(f.b) {
        assert_eq!(Some(value.0), f.model[&id_of(&f.store, h)].1);
    }
}

fn lone_store() -> (Store, ComponentKey<A>, ComponentKey<B>) {
    let mut builder = SchemaBuilder::default();
    let a = builder.register::<A>("a");
    let b = builder.register::<B>("b");
    (Store::new(&builder.build(), FloorId(0)), a, b)
}

#[test]
#[should_panic(expected = "join of a component with itself")]
fn join_of_a_key_with_itself_panics() {
    let (store, a, _) = lone_store();
    let _ = store.join(a, a);
}

#[test]
#[should_panic(expected = "join of a component with itself")]
fn join_mut_of_a_key_with_itself_panics() {
    let (mut store, a, _) = lone_store();
    store.join_mut(a, a, |_, _: &mut A, _: &mut A| {});
}

/// Keys 1 and 2 of a three-component schema: the first has the wrong type
/// for `lone_store`, the second is out of its range.
fn foreign_keys() -> (ComponentKey<A>, ComponentKey<A>) {
    let mut builder = SchemaBuilder::default();
    builder.register::<A>("x");
    let mismatched = builder.register::<A>("y");
    let out_of_range = builder.register::<A>("z");
    (mismatched, out_of_range)
}

#[test]
#[should_panic(expected = "component key from another schema")]
fn join_with_an_out_of_range_key_panics() {
    let (store, a, _) = lone_store();
    let (_, out_of_range) = foreign_keys();
    let _ = store.join(a, out_of_range);
}

#[test]
#[should_panic(expected = "component key from another schema")]
fn join_mut_with_an_out_of_range_key_panics() {
    let (mut store, a, _) = lone_store();
    let (_, out_of_range) = foreign_keys();
    store.join_mut(a, out_of_range, |_, _: &mut A, _: &mut A| {});
}

#[test]
#[should_panic(expected = "component key from another schema")]
fn join_with_a_mismatched_key_panics() {
    let (store, a, _) = lone_store();
    let (mismatched, _) = foreign_keys();
    let _ = store.join(a, mismatched);
}

#[test]
#[should_panic(expected = "component key from another schema")]
fn join_mut_with_a_mismatched_key_panics() {
    let (mut store, a, _) = lone_store();
    let (mismatched, _) = foreign_keys();
    store.join_mut(a, mismatched, |_, _: &mut A, _: &mut A| {});
}
