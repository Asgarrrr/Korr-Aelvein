use korr_ecs::{
    Component, ComponentKey, EntityId, FloorId, ImageError, Reader, Schema, SchemaBuilder, Store,
    Writer,
};

#[derive(Debug, PartialEq, Eq)]
struct Satiety(u32);

impl Component for Satiety {
    fn write(&self, w: &mut Writer) {
        w.write_u32(self.0);
    }

    fn read(r: &mut Reader<'_>) -> Result<Self, ImageError> {
        r.read_u32().map(Self)
    }
}

#[derive(Debug, PartialEq, Eq)]
struct Dread(u8);

impl Component for Dread {
    fn write(&self, w: &mut Writer) {
        w.write_u8(self.0);
    }

    fn read(r: &mut Reader<'_>) -> Result<Self, ImageError> {
        r.read_u8().map(Self)
    }
}

const _: () = {
    const fn assert_send<T: Send>() {}
    assert_send::<Store>();
};

fn register_hunger(builder: &mut SchemaBuilder) -> ComponentKey<Satiety> {
    builder.register("satiety")
}

fn register_fear(builder: &mut SchemaBuilder) -> ComponentKey<Dread> {
    builder.register("dread")
}

fn hunger_only() -> (Schema, ComponentKey<Satiety>) {
    let mut builder = SchemaBuilder::default();
    let satiety = register_hunger(&mut builder);
    (builder.build(), satiety)
}

#[test]
fn ids_are_monotonic_per_floor() {
    let (schema, _) = hunger_only();
    let mut store = Store::new(&schema, FloorId(3));
    assert!(store.is_empty());
    let spawned = [store.spawn(), store.spawn(), store.spawn()];
    let counters = spawned.map(|h| store.id(h).map(EntityId::counter));
    assert_eq!(counters, [Some(0), Some(1), Some(2)]);
    assert_eq!(
        store.id(spawned[0]).map(EntityId::origin),
        Some(store.floor())
    );
    assert_eq!(store.floor(), FloorId(3));

    store.despawn(spawned[1]);
    let next = store.spawn();
    assert_eq!(store.id(next).map(EntityId::counter), Some(3));
    assert_eq!(store.len(), 3);
    assert!(!store.is_empty());
}

#[test]
fn recycled_slot_keeps_its_slot_idx() {
    let (schema, _) = hunger_only();
    let mut store = Store::new(&schema, FloorId(0));
    let a = store.spawn();
    let b = store.spawn();
    store.despawn(a);
    let c = store.spawn();
    assert_eq!(c.slot(), a.slot());
    assert_ne!(c, a);
    assert_ne!(b.slot(), a.slot());
}

#[test]
fn reused_slot_starts_without_components() {
    let (schema, satiety) = hunger_only();
    let mut store = Store::new(&schema, FloorId(0));
    let old = store.spawn();
    store.insert(satiety, old, Satiety(7));
    store.despawn(old);

    let new = store.spawn();
    assert_ne!(old, new);
    assert!(!store.is_alive(old));
    assert!(store.is_alive(new));
    assert_eq!(store.id(old), None);
    assert_eq!(store.get(satiety, new), None);

    store.insert(satiety, new, Satiety(9));
    assert_eq!(store.get(satiety, old), None);
}

#[test]
fn insert_returns_the_previous_value() {
    let (schema, satiety) = hunger_only();
    let mut store = Store::new(&schema, FloorId(0));
    let h = store.spawn();
    assert_eq!(store.insert(satiety, h, Satiety(1)), None);
    assert_eq!(store.insert(satiety, h, Satiety(2)), Some(Satiety(1)));
    assert_eq!(store.get(satiety, h), Some(&Satiety(2)));
}

#[test]
#[should_panic(expected = "despawn of a dead handle")]
fn double_despawn_panics() {
    let (schema, _) = hunger_only();
    let mut store = Store::new(&schema, FloorId(0));
    let h = store.spawn();
    store.despawn(h);
    store.despawn(h);
}

#[test]
#[should_panic(expected = "insert on a dead handle")]
fn insert_on_a_dead_handle_panics() {
    let (schema, satiety) = hunger_only();
    let mut store = Store::new(&schema, FloorId(0));
    let h = store.spawn();
    store.despawn(h);
    store.insert(satiety, h, Satiety(1));
}

#[test]
#[should_panic(expected = "component name registered twice: satiety")]
fn duplicate_name_panics() {
    let mut builder = SchemaBuilder::default();
    register_hunger(&mut builder);
    register_hunger(&mut builder);
}

#[test]
#[should_panic(expected = "component name must not be empty")]
fn empty_name_panics() {
    SchemaBuilder::default().register::<Satiety>("");
}

#[test]
#[should_panic(expected = "component name longer than u16::MAX bytes")]
fn register_rejects_a_name_the_image_cannot_hold() {
    let name = "n".repeat(usize::from(u16::MAX) + 1).leak();
    SchemaBuilder::default().register::<Satiety>(name);
}

#[test]
#[should_panic(expected = "component key from another schema")]
fn key_past_the_schema_panics() {
    let mut wide = SchemaBuilder::default();
    register_hunger(&mut wide);
    let dread = register_fear(&mut wide);
    let (narrow, _) = hunger_only();
    let mut store = Store::new(&narrow, FloorId(0));
    let h = store.spawn();
    store.insert(dread, h, Dread(1));
}

#[test]
#[should_panic(expected = "component key from another schema")]
fn key_of_another_type_panics() {
    let mut fear_first = SchemaBuilder::default();
    let dread = register_fear(&mut fear_first);
    let (hunger, _) = hunger_only();
    let mut store = Store::new(&hunger, FloorId(0));
    let h = store.spawn();
    let _value = store.get(dread, h);
}

fn round_trip(schema: &Schema, satiety: ComponentKey<Satiety>, dread: Option<ComponentKey<Dread>>) {
    let mut store = Store::new(schema, FloorId(0));
    let h = store.spawn();
    store.insert(satiety, h, Satiety(5));
    if let Some(dread) = dread {
        store.insert(dread, h, Dread(2));
        assert_eq!(store.get(dread, h), Some(&Dread(2)));
    }
    assert_eq!(store.get(satiety, h), Some(&Satiety(5)));
}

#[test]
fn two_modules_register_independently() {
    let mut hunger_first = SchemaBuilder::default();
    let satiety = register_hunger(&mut hunger_first);
    let dread = register_fear(&mut hunger_first);
    round_trip(&hunger_first.build(), satiety, Some(dread));

    let mut fear_first = SchemaBuilder::default();
    let dread = register_fear(&mut fear_first);
    let satiety = register_hunger(&mut fear_first);
    round_trip(&fear_first.build(), satiety, Some(dread));

    let (fear_disabled, satiety) = hunger_only();
    round_trip(&fear_disabled, satiety, None);
}
