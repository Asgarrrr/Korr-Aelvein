use korr_ecs::{
    Component, EntityId, FloorId, ImageError, Reader, SchemaBuilder, Store, Traveller, Writer,
};

use crate::driver::{Hunger, Pos, World, schema};

const AT: Pos = Pos { x: 3, y: -4 };

fn encode(traveller: &Traveller) -> Vec<u8> {
    let mut w = Writer::new();
    traveller.write(&mut w);
    w.into_bytes()
}

fn decode(bytes: &[u8]) -> Traveller {
    let mut r = Reader::new(bytes);
    let traveller = Traveller::read(&mut r).expect("an encoded traveller reads back");
    r.finish().expect("a traveller consumes its bytes");
    traveller
}

#[test]
fn detach_attach_preserves_id_and_components() {
    let (schema, keys) = schema();
    let mut source = Store::new(&schema, FloorId(0));
    let mut destination = Store::new(&schema, FloorId(1));
    let stays = source.spawn();
    let h = source.spawn();
    source.insert(keys.pos, h, AT);
    source.insert(keys.hunger, h, Hunger(9));
    let id = source.id(h).expect("spawned");

    let traveller = source.detach(h);
    assert_eq!(traveller.id(), id);
    assert!(!source.is_alive(h));
    assert!(source.is_alive(stays));
    assert_eq!(source.len(), 1);
    assert!(source.values(keys.pos).is_empty());
    assert!(source.values(keys.hunger).is_empty());

    let h2 = destination
        .attach(traveller)
        .expect("a detached row attaches");
    assert_eq!(destination.id(h2), Some(id));
    assert_eq!(id.origin(), FloorId(0));
    assert_eq!(destination.get(keys.pos, h2), Some(&AT));
    assert_eq!(destination.get(keys.hunger, h2), Some(&Hunger(9)));

    let native = destination.spawn();
    assert_eq!(destination.id(native), Some(EntityId::new(FloorId(1), 0)));
    let next = source.spawn();
    assert_eq!(source.id(next), Some(EntityId::new(FloorId(0), 2)));
}

#[test]
fn absent_components_stay_absent() {
    let (schema, keys) = schema();
    let mut source = Store::new(&schema, FloorId(0));
    let mut destination = Store::new(&schema, FloorId(1));
    let bare = source.spawn();
    let placed = source.spawn();
    source.insert(keys.pos, placed, AT);

    let bare = destination
        .attach(source.detach(bare))
        .expect("a bare row attaches");
    let placed = destination
        .attach(source.detach(placed))
        .expect("a partial row attaches");
    assert_eq!(destination.get(keys.pos, bare), None);
    assert_eq!(destination.get(keys.hunger, bare), None);
    assert_eq!(destination.get(keys.pos, placed), Some(&AT));
    assert_eq!(destination.get(keys.hunger, placed), None);
    assert!(destination.values(keys.hunger).is_empty());
}

#[test]
fn round_trip_to_origin() {
    let (schema, keys) = schema();
    let mut origin = Store::new(&schema, FloorId(0));
    let mut away = Store::new(&schema, FloorId(1));
    let h = origin.spawn();
    origin.insert(keys.hunger, h, Hunger(4));
    let id = origin.id(h).expect("spawned");

    let there = away.attach(origin.detach(h)).expect("attaches away");
    let back = origin.attach(away.detach(there)).expect("attaches home");
    assert!(away.is_empty());
    assert_eq!(origin.id(back), Some(id));
    assert_eq!(origin.get(keys.hunger, back), Some(&Hunger(4)));
    let next = origin.spawn();
    assert_eq!(origin.id(next), Some(EntityId::new(FloorId(0), 1)));
}

#[test]
fn traveller_survives_encoding() {
    let (schema, keys) = schema();
    let mut source = Store::new(&schema, FloorId(0));
    let mut destination = Store::new(&schema, FloorId(1));
    let h = source.spawn();
    source.insert(keys.pos, h, AT);
    source.insert(keys.hunger, h, Hunger(9));

    let traveller = source.detach(h);
    let decoded = decode(&encode(&traveller));
    assert_eq!(decoded, traveller);
    let h2 = destination.attach(decoded).expect("a decoded row attaches");
    assert_eq!(destination.get(keys.pos, h2), Some(&AT));
    assert_eq!(destination.get(keys.hunger, h2), Some(&Hunger(9)));
}

#[test]
fn attach_rejects_foreign_schema_and_leaves_store_unchanged() {
    let (full, keys) = schema();
    let mut builder = SchemaBuilder::default();
    let pos_only = builder.register::<Pos>("pos");
    let narrow = builder.build();

    let mut wide = Store::new(&full, FloorId(0));
    let mut thin = Store::new(&narrow, FloorId(1));
    for _ in 0..3 {
        let h = wide.spawn();
        wide.insert(keys.pos, h, AT);
        let h = thin.spawn();
        thin.insert(pos_only, h, AT);
    }
    let leaving = wide.spawn();
    let from_wide = wide.detach(leaving);
    let leaving = thin.spawn();
    let from_thin = thin.detach(leaving);

    let before = thin.save();
    assert_eq!(thin.attach(from_wide), Err(ImageError::Schema { index: 2 }));
    assert_eq!(thin.save(), before);

    let before = wide.save();
    assert_eq!(wide.attach(from_thin), Err(ImageError::Schema { index: 1 }));
    assert_eq!(wide.save(), before);
}

fn traveller(id: EntityId, row: &[u8]) -> Traveller {
    let mut w = Writer::new();
    w.write_u64(id.to_bits());
    w.write_u32(u32::try_from(row.len()).expect("fits u32"));
    w.write_bytes(row);
    decode(&w.into_bytes())
}

fn bare_traveller(id: EntityId) -> Traveller {
    let mut row = Writer::new();
    row.write_u32(2);
    row.write_u8(0);
    row.write_u8(0);
    traveller(id, &row.into_bytes())
}

/// A valid `pos` column followed by `hunger_column` as raw bytes.
fn row_with_hunger(hunger_column: &[u8]) -> Vec<u8> {
    let mut row = Writer::new();
    row.write_u32(2);
    row.write_u8(1);
    AT.write(&mut row);
    row.write_bytes(hunger_column);
    row.into_bytes()
}

#[test]
fn attach_rejects_a_bad_later_column_and_leaves_store_unchanged() {
    let (schema, keys) = schema();
    let mut store = Store::new(&schema, FloorId(1));
    let h = store.spawn();
    store.insert(keys.pos, h, AT);
    let foreign = EntityId::new(FloorId(0), 7);

    for (hunger_column, error) in [
        (&[2][..], ImageError::Corrupt("presence")),
        (&[1, 9][..], ImageError::Truncated { at: 14 }),
        (&[1, 9, 0, 0][..], ImageError::Trailing(1)),
    ] {
        let before = store.save();
        assert_eq!(
            store.attach(traveller(foreign, &row_with_hunger(hunger_column))),
            Err(error)
        );
        assert_eq!(store.save(), before);
        assert_eq!(store.len(), 1);
    }
}

#[test]
fn attach_rejects_id_beyond_counter() {
    let (schema, _) = schema();
    let mut store = Store::new(&schema, FloorId(2));
    store.spawn();

    let before = store.save();
    assert_eq!(
        store.attach(bare_traveller(EntityId::new(FloorId(2), 1))),
        Err(ImageError::Corrupt("id beyond the floor counter"))
    );
    assert_eq!(store.save(), before);

    let foreign = EntityId::new(FloorId(5), 1);
    let h = store
        .attach(bare_traveller(foreign))
        .expect("a foreign id past this floor's counter attaches");
    assert_eq!(store.id(h), Some(foreign));
}

#[test]
fn world_model_with_travel() {
    for seed in 1..=3 {
        let mut world = World::new(seed, 3);
        for _ in 0..40 {
            world.run(500);
            world.check();
        }
    }
}

#[test]
fn reload_with_traveller_in_flight_matches_uninterrupted_run() {
    for seed in 1..=3 {
        let mut direct = World::new(seed, 3);
        direct.run(5_000);
        let traveller = direct.depart(0);
        direct.arrive(traveller, 2);
        direct.run(5_000);

        let mut reloaded = World::new(seed, 3);
        reloaded.run(5_000);
        let bytes = encode(&reloaded.depart(0));
        reloaded.reload();
        reloaded.arrive(decode(&bytes), 2);
        reloaded.check();
        reloaded.run(5_000);
        reloaded.check();
        assert_eq!(reloaded.images(), direct.images(), "seed {seed}");
    }
}
