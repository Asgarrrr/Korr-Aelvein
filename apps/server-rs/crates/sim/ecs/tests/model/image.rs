use korr_ecs::{
    Component, EntityId, FloorId, Handle, ImageError, Schema, SchemaBuilder, Store, Writer,
    checksum,
};

use crate::driver::{Hunger, Keys, Pos, World, schema};

const HEADER_AND_CHECKSUM: usize = 28;
const COUNTER_AT: usize = 12;
const ID_SPACE: u64 = 1 << 47;

fn image_after(seed: u64, steps: u64) -> Vec<u8> {
    let mut world = World::new(seed, 1);
    world.run(steps);
    world.images().remove(0)
}

fn reseal(bytes: &mut [u8]) {
    let body = bytes.len() - 8;
    let sum = checksum(&bytes[..body]);
    bytes[body..].copy_from_slice(&sum.to_le_bytes());
}

fn exercise(store: &mut Store, keys: Keys) {
    for i in 0..100 {
        let kept = store.spawn();
        let gone = store.spawn();
        store.insert(keys.pos, kept, Pos { x: i, y: -i });
        store.insert(keys.hunger, gone, Hunger(7));
        store.despawn(gone);
    }
    let holders: Vec<Handle> = store.iter(keys.pos).map(|(h, _)| h).collect();
    for h in holders {
        store.despawn(h);
    }
    let holders: Vec<Handle> = store.iter(keys.hunger).map(|(h, _)| h).collect();
    for h in holders {
        store.despawn(h);
    }
}

#[test]
fn save_load_save_is_byte_equal() {
    let image = image_after(1, 5_000);
    let loaded = Store::load(&schema().0, &image).expect("own image loads");
    assert_eq!(loaded.save(), image);
}

#[test]
fn reload_mid_run_matches_uninterrupted_run() {
    for seed in 1..=3 {
        let mut straight = World::new(seed, 1);
        straight.run(10_000);
        let mut reloaded = World::new(seed, 1);
        reloaded.run(5_000);
        reloaded.reload();
        reloaded.check();
        reloaded.run(5_000);
        reloaded.check();
        assert_eq!(reloaded.images(), straight.images(), "seed {seed}");
    }
}

#[test]
fn every_strict_prefix_is_rejected() {
    let schema = schema().0;
    let image = image_after(1, 300);
    for n in 0..image.len() {
        let expected = if n < HEADER_AND_CHECKSUM {
            ImageError::Truncated { at: n }
        } else {
            ImageError::Checksum
        };
        assert_eq!(
            Store::load(&schema, &image[..n]).err(),
            Some(expected),
            "{n}"
        );
    }
}

#[test]
fn every_byte_flip_fails_the_checksum() {
    let schema = schema().0;
    let image = image_after(1, 300);
    for index in 0..image.len() {
        let mut bytes = image.clone();
        bytes[index] ^= 0xFF;
        assert_eq!(
            Store::load(&schema, &bytes).err(),
            Some(ImageError::Checksum),
            "{index}"
        );
    }
}

#[test]
fn resealed_flips_never_panic() {
    let (schema, keys) = schema();
    // Seed 3 ends with three slots on the free stack.
    let image = image_after(3, 300);
    for index in 0..image.len() - 8 {
        for mask in [0x01, 0x80, 0xFF] {
            let mut bytes = image.clone();
            bytes[index] ^= mask;
            reseal(&mut bytes);
            if let Ok(mut store) = Store::load(&schema, &bytes) {
                assert_eq!(store.save(), bytes, "{index} ^ {mask:#x}");
                exercise(&mut store, keys);
            }
        }
    }
}

#[test]
fn counter_past_the_id_space_is_corrupt() {
    let schema = schema().0;
    let mut image = World::new(1, 1).images().remove(0);
    let counter = COUNTER_AT..COUNTER_AT + 8;
    image[counter.clone()].copy_from_slice(&ID_SPACE.to_le_bytes());
    reseal(&mut image);
    assert!(Store::load(&schema, &image).is_ok());

    image[counter].copy_from_slice(&(ID_SPACE + 1).to_le_bytes());
    reseal(&mut image);
    assert_eq!(
        Store::load(&schema, &image).err(),
        Some(ImageError::Corrupt("floor counter"))
    );
}

fn schema_of(names: &[&'static str]) -> Schema {
    let mut builder = SchemaBuilder::default();
    for &name in names {
        if name == "hunger" {
            builder.register::<Hunger>(name);
        } else {
            builder.register::<Pos>(name);
        }
    }
    builder.build()
}

#[test]
fn schema_mismatch_is_rejected() {
    let image = image_after(1, 300);
    for names in [
        &["pos"][..],
        &["hunger", "pos"],
        &["pos", "hunger", "extra"],
    ] {
        assert!(
            matches!(
                Store::load(&schema_of(names), &image),
                Err(ImageError::Schema { .. })
            ),
            "{names:?}"
        );
    }
}

#[test]
fn empty_floor_round_trips() {
    let schema = schema().0;
    let image = Store::new(&schema, FloorId(9)).save();
    let loaded = Store::load(&schema, &image).expect("an empty floor loads");
    assert!(loaded.is_empty());
    assert_eq!(loaded.floor(), FloorId(9));
    assert_eq!(loaded.save(), image);
}

enum Slot {
    Alive(u64),
    Dead(u32),
    State(u8),
}

/// A floor image written field by field, so each test breaks one field.
struct Floor {
    slots: Vec<Slot>,
    free: Vec<u32>,
    pos_owners: Vec<u32>,
}

impl Floor {
    fn valid() -> Self {
        Self {
            slots: vec![Slot::Alive(0), Slot::Dead(1), Slot::Alive(2)],
            free: vec![1],
            pos_owners: vec![0, 2],
        }
    }

    #[expect(
        clippy::cast_possible_truncation,
        reason = "test images hold a handful of slots"
    )]
    fn seal(&self) -> Vec<u8> {
        let mut w = Writer::new();
        w.write_bytes(b"KORRFLR\0");
        w.write_u16(1);
        w.write_u16(0);
        w.write_u64(3);
        w.write_u32(self.slots.len() as u32);
        for slot in &self.slots {
            match *slot {
                Slot::Alive(bits) => {
                    w.write_u32(0);
                    w.write_u8(1);
                    w.write_u64(bits);
                }
                Slot::Dead(generation) => {
                    w.write_u32(generation);
                    w.write_u8(0);
                }
                Slot::State(state) => {
                    w.write_u32(0);
                    w.write_u8(state);
                }
            }
        }
        w.write_u32(self.free.len() as u32);
        for &slot in &self.free {
            w.write_u32(slot);
        }
        w.write_u32(2);
        w.write_u16(3);
        w.write_bytes(b"pos");
        w.write_u32(self.pos_owners.len() as u32);
        for &slot in &self.pos_owners {
            w.write_u32(slot);
            Pos { x: 1, y: -1 }.write(&mut w);
        }
        w.write_u16(6);
        w.write_bytes(b"hunger");
        w.write_u32(0);
        let mut bytes = w.into_bytes();
        let sum = checksum(&bytes);
        bytes.extend_from_slice(&sum.to_le_bytes());
        bytes
    }

    fn load(&self) -> Result<Store, ImageError> {
        Store::load(&schema().0, &self.seal())
    }
}

#[test]
fn hand_built_floors_load() {
    let valid = Floor::valid();
    assert_eq!(valid.load().expect("valid floor").save(), valid.seal());

    let traveller = Floor {
        slots: vec![
            Slot::Alive(0),
            Slot::Dead(1),
            Slot::Alive(EntityId::new(FloorId(1), 99).to_bits()),
        ],
        ..Floor::valid()
    };
    assert!(traveller.load().is_ok());

    let retired = Floor {
        slots: vec![Slot::Alive(0), Slot::Dead(u32::MAX), Slot::Alive(2)],
        free: vec![],
        ..Floor::valid()
    };
    assert!(retired.load().is_ok());
}

#[test]
fn bad_slot_table_is_corrupt() {
    for (slot, reason) in [
        (Slot::State(2), "slot state"),
        (Slot::Alive(1 << 63), "entity id"),
        (Slot::Alive(0), "duplicate entity id"),
        (Slot::Alive(3), "id beyond the floor counter"),
    ] {
        let mut floor = Floor::valid();
        floor.slots[2] = slot;
        assert_eq!(floor.load().err(), Some(ImageError::Corrupt(reason)));
    }
}

#[test]
fn bad_free_list_is_corrupt() {
    for free in [&[0][..], &[7], &[]] {
        let floor = Floor {
            free: free.to_vec(),
            ..Floor::valid()
        };
        assert_eq!(
            floor.load().err(),
            Some(ImageError::Corrupt("free list")),
            "{free:?}"
        );
    }
    let retired = Floor {
        slots: vec![Slot::Alive(0), Slot::Dead(u32::MAX), Slot::Alive(2)],
        ..Floor::valid()
    };
    assert_eq!(retired.load().err(), Some(ImageError::Corrupt("free list")));

    let repeated = Floor {
        slots: vec![Slot::Alive(0), Slot::Dead(1), Slot::Alive(2), Slot::Dead(1)],
        free: vec![1, 1],
        ..Floor::valid()
    };
    assert_eq!(
        repeated.load().err(),
        Some(ImageError::Corrupt("free list"))
    );
}

#[test]
fn bad_column_owner_is_corrupt() {
    for owners in [&[0, 1][..], &[0, 0], &[0, 9]] {
        let floor = Floor {
            pos_owners: owners.to_vec(),
            ..Floor::valid()
        };
        assert_eq!(
            floor.load().err(),
            Some(ImageError::Corrupt("column owner")),
            "{owners:?}"
        );
    }
}
