use korr_ecs::{Component, FloorId, ImageError, Own, Reader, Schema, SchemaBuilder, Store, Writer};

#[derive(Debug, PartialEq, Eq)]
struct Satiety(u32);

impl Component for Satiety {
    const VERSION: u16 = 0;

    fn write(&self, w: &mut Writer) {
        w.write_u32(self.0);
    }

    fn read(r: &mut Reader<'_>) -> Result<Self, ImageError> {
        r.read_u32().map(Self)
    }
}

fn hunger_only() -> (Schema, Own<Satiety>) {
    let mut builder = SchemaBuilder::default();
    let satiety = builder.register("satiety");
    (builder.build(), satiety)
}

#[test]
#[should_panic(expected = "lent")]
fn get_through_a_lent_key_panics() {
    let (schema, satiety) = hunger_only();
    let mut store = Store::new(&schema, FloorId(0));
    let h = store.spawn();
    let _lent = store.lend(&satiety);
    let _ = store.get(satiety.read(), h);
}

#[test]
fn the_store_sees_what_the_lent_column_kept() {
    let (schema, satiety) = hunger_only();
    let mut store = Store::new(&schema, FloorId(0));
    let [kept, removed, dead] = [store.spawn(), store.spawn(), store.spawn()];
    store.insert(&satiety, removed, Satiety(1));
    let mut lent = store.lend(&satiety);
    assert_eq!(lent.insert(&store, kept, Satiety(2)), None);
    assert_eq!(lent.insert(&store, kept, Satiety(3)), Some(Satiety(2)));
    assert_eq!(lent.remove(&store, removed), Some(Satiety(1)));
    lent.insert(&store, dead, Satiety(4));
    lent.clear(dead);
    store.despawn(dead);
    let reborn = store.spawn();
    assert_eq!(reborn.slot(), dead.slot());
    assert_eq!(lent.get(&store, reborn), None);
    lent.insert(&store, reborn, Satiety(5));
    assert_eq!(lent.get(&store, dead), None, "a stale handle reads nothing");
    store.restore(lent);

    assert_eq!(store.get(satiety.read(), kept), Some(&Satiety(3)));
    assert_eq!(store.get(satiety.read(), removed), None);
    assert_eq!(store.get(satiety.read(), dead), None);
    assert_eq!(store.get(satiety.read(), reborn), Some(&Satiety(5)));
}

#[test]
#[cfg(debug_assertions)]
#[should_panic(expected = "restore to another store")]
fn a_column_is_restored_only_to_the_store_that_lent_it() {
    let (schema, satiety) = hunger_only();
    let mut lender = Store::new(&schema, FloorId(0));
    let mut other = Store::new(&schema, FloorId(1));
    let _kept = other.lend(&satiety);
    other.restore(lender.lend(&satiety));
}
