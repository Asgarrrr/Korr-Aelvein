use std::num::NonZeroU32;

use korr_ecs::{FloorId, Handle, ImageError, Reader, SchemaBuilder, Store, Traveller, Writer};
use korr_grid::{Dir, Grid, MAX_STEP, Material, Pos, Shape, StepError};
use korr_random::{DrawIndex, ModuleKey, Phase, Seed, Stream, Subject};

/// 256 interior cells: one per `i8` height.
const SIDE: u16 = 18;
const ACTOR: u8 = 0;
const THING: u8 = 1;

/// A placement record as the image holds it: `EntityId` bits, layer byte, position.
type Record = (u64, u8, Pos);

fn store() -> Store {
    Store::new(&SchemaBuilder::default().build(), FloorId(0))
}

fn shape(width: u16, height: u16) -> Shape {
    Shape::new(width, height).expect("test shapes fit the bounds")
}

fn bytes(grid: &Grid) -> Vec<u8> {
    let mut w = Writer::new();
    grid.write(&mut w);
    w.into_bytes()
}

fn read(bytes: &[u8], store: &Store) -> Result<Grid, ImageError> {
    Grid::read(&mut Reader::new(bytes), store, |id| {
        store.handles().find(|&h| store.id(h) == Some(id))
    })
}

/// The image of `terrain`, an unlinked grid, with `records` in place of its empty list.
fn forged(terrain: &Grid, records: &[Record]) -> Vec<u8> {
    let mut image = bytes(terrain);
    let count = image.split_off(image.len() - 4);
    assert_eq!(count, [0; 4], "an unlinked grid writes no record");
    let mut w = Writer::new();
    w.write_u32(u32::try_from(records.len()).expect("a test writes few records"));
    for &(bits, layer, p) in records {
        w.write_u64(bits);
        w.write_u8(layer);
        w.write_i16(p.x);
        w.write_i16(p.y);
    }
    image.extend(w.into_bytes());
    image
}

fn slot(h: Handle) -> u32 {
    h.slot().get()
}

fn bits(store: &Store, h: Handle) -> u64 {
    store.id(h).expect("a test handle is alive").to_bits()
}

fn seeded() -> Grid {
    let shape = shape(SIDE, SIDE);
    let mut grid = Grid::new(shape);
    let stream = Stream::new(Seed(1), ModuleKey::of("grid-image"), Phase::Action, 0);
    let bound = NonZeroU32::new(4).expect("4 is not zero");
    let mut next = 0u8;
    for y in 1..SIDE - 1 {
        for x in 1..SIDE - 1 {
            let p = pos(x, y);
            let at = shape.idx(p).expect("the loop stays inside the ring");
            let subject = Subject::Cell(u64::from(y) * u64::from(SIDE) + u64::from(x));
            if stream.below(subject, DrawIndex(0), bound) == 0 {
                grid.set_material(at, Material::WALL);
            }
            grid.set_height(at, i8::from_le_bytes([next]));
            next = next.wrapping_add(1);
        }
    }
    grid
}

fn pos(x: u16, y: u16) -> Pos {
    let coord = |v: u16| i16::try_from(v).expect("a test side fits i16");
    Pos {
        x: coord(x),
        y: coord(y),
    }
}

fn header(width: u16, height: u16) -> Vec<u8> {
    let mut w = Writer::new();
    w.write_u16(width);
    w.write_u16(height);
    w.into_bytes()
}

/// A 4x4 floor: a wall east of (1, 1), a cliff south of it, ground south-east.
fn cliff() -> Grid {
    let shape = shape(4, 4);
    let mut grid = Grid::new(shape);
    let wall = shape.idx(Pos { x: 2, y: 1 }).expect("inside");
    let cliff = shape.idx(Pos { x: 1, y: 2 }).expect("inside");
    grid.set_material(wall, Material::WALL);
    grid.set_height(cliff, i8::try_from(MAX_STEP).expect("MAX_STEP fits i8") + 1);
    grid
}

#[test]
fn write_read_write_is_byte_equal() {
    let image = bytes(&seeded());
    let reloaded = read(&image, &store()).expect("own image reads");
    assert_eq!(bytes(&reloaded), image);
}

#[test]
fn every_strict_prefix_is_truncated() {
    let image = bytes(&seeded());
    let store = store();
    for n in 0..image.len() {
        assert!(
            matches!(read(&image[..n], &store), Err(ImageError::Truncated { .. })),
            "{n}"
        );
    }
}

#[test]
fn huge_shape_without_layers_is_truncated() {
    let image = header(32_767, 32_767);
    assert!(matches!(
        read(&image, &store()),
        Err(ImageError::Truncated { .. })
    ));
}

#[test]
fn bad_side_is_corrupt() {
    let mut image = header(2, 3);
    image.extend_from_slice(&[1, 0]);
    assert_eq!(
        read(&image, &store()).err(),
        Some(ImageError::Corrupt("floor shape"))
    );
}

#[test]
fn unknown_material_is_corrupt() {
    let mut image = header(3, 3);
    image.extend_from_slice(&[2, 0]);
    assert_eq!(
        read(&image, &store()).err(),
        Some(ImageError::Corrupt("material"))
    );
}

#[test]
fn position_on_the_ring_is_corrupt() {
    let terrain = cliff();
    let mut store = store();
    let h = store.spawn();
    for layer in [ACTOR, THING] {
        assert_eq!(
            read(
                &forged(&terrain, &[(bits(&store, h), layer, Pos { x: 0, y: 1 })]),
                &store
            )
            .err(),
            Some(ImageError::Corrupt("position off the floor")),
            "{layer}"
        );
    }
}

#[test]
fn rebuild_rejects_position_off_shape() {
    let terrain = cliff();
    let mut store = store();
    let h = store.spawn();
    for p in [
        Pos { x: -1, y: 1 },
        Pos { x: 1, y: 4 },
        Pos { x: 99, y: 99 },
    ] {
        assert_eq!(
            read(&forged(&terrain, &[(bits(&store, h), ACTOR, p)]), &store).err(),
            Some(ImageError::Corrupt("position off the floor")),
            "{p:?}"
        );
    }
}

#[test]
fn rebuild_accepts_actor_and_thing_on_wall() {
    let mut store = store();
    let (a, t) = (store.spawn(), store.spawn());
    let wall = Pos { x: 2, y: 1 };
    let image = forged(
        &cliff(),
        &[
            (bits(&store, a), ACTOR, wall),
            (bits(&store, t), THING, wall),
        ],
    );
    assert!(read(&image, &store).is_ok());
}

#[test]
fn two_actors_on_one_cell_is_corrupt() {
    let mut store = store();
    let a = store.spawn();
    let b = store.spawn();
    let at = Pos { x: 1, y: 1 };
    let image = forged(
        &cliff(),
        &[(bits(&store, a), ACTOR, at), (bits(&store, b), ACTOR, at)],
    );
    assert_eq!(
        read(&image, &store).err(),
        Some(ImageError::Corrupt("two actors on one cell"))
    );
}

#[test]
fn rebuild_orders_things_by_id() {
    let mut store = store();
    let old: Vec<Handle> = (0..4).map(|_| store.spawn()).collect();
    store.despawn(old[0]);
    store.despawn(old[1]);
    let recycled = [store.spawn(), store.spawn()];
    let mut by_slot: Vec<Handle> = recycled.iter().chain(&old[2..]).copied().collect();
    by_slot.sort_unstable_by_key(|&h| slot(h));
    let mut by_id = by_slot.clone();
    by_id.sort_unstable_by_key(|&h| store.id(h));
    assert_ne!(by_slot, by_id, "recycled slots must hold the newest ids");
    let at = Pos { x: 1, y: 1 };
    let records: Vec<Record> = by_id
        .iter()
        .map(|&h| (bits(&store, h), THING, at))
        .collect();
    let grid = read(&forged(&cliff(), &records), &store).expect("things on ground rebuild");
    let cell = grid.shape().idx(at).expect("inside").cell();
    assert_eq!(grid.things(cell).collect::<Vec<_>>(), by_id);
}

#[test]
fn rebuilt_grid_steps_like_the_original() {
    let mut store = store();
    let h = store.spawn();
    let start = Pos { x: 1, y: 1 };
    let mut original = cliff();
    original.link_actor(&store, h, original.shape().idx(start).expect("inside"));
    let mut rebuilt = read(&bytes(&original), &store).expect("own image rebuilds");
    for (dir, expected) in [
        (Dir::East, Err(StepError::Blocked)),
        (Dir::South, Err(StepError::TooSteep)),
        (Dir::SouthEast, Ok(Pos { x: 2, y: 2 })),
    ] {
        assert_eq!(original.step(h, dir), expected, "{dir:?}");
        assert_eq!(rebuilt.step(h, dir), expected, "{dir:?}");
    }
}

#[test]
fn placement_records_round_trip_byte_equal() {
    let mut store = store();
    let mut original = seeded();
    let shape = original.shape();
    let handles: Vec<Handle> = (0..12).map(|_| store.spawn()).collect();
    for (i, &h) in (0u16..).zip(&handles) {
        let at = shape.idx(pos(1 + i % 4, 1 + i / 4)).expect("inside");
        if i % 3 == 0 {
            original.link_thing(&store, h, at);
        } else {
            original.link_actor(&store, h, at);
        }
    }
    let shared = shape.idx(pos(1, 1)).expect("inside");
    let extra = store.spawn();
    original.link_thing(&store, extra, shared);
    let image = bytes(&original);
    let reloaded = read(&image, &store).expect("own image reads");
    assert_eq!(bytes(&reloaded), image);
    for y in 1..SIDE - 1 {
        for x in 1..SIDE - 1 {
            let cell = shape.idx(pos(x, y)).expect("inside").cell();
            assert_eq!(reloaded.actor_at(cell), original.actor_at(cell), "{x},{y}");
            assert!(reloaded.things(cell).eq(original.things(cell)), "{x},{y}");
        }
    }
}

#[test]
fn a_record_of_an_absent_entity_is_corrupt() {
    let mut store = store();
    let h = store.spawn();
    let mut grid = cliff();
    grid.link_thing(
        &store,
        h,
        grid.shape().idx(Pos { x: 1, y: 1 }).expect("inside"),
    );
    assert_eq!(
        Grid::read(&mut Reader::new(&bytes(&grid)), &store, |_| None).err(),
        Some(ImageError::Corrupt("placement of an absent entity"))
    );
}

#[test]
fn a_record_resolved_to_another_entity_is_corrupt() {
    let mut store = store();
    let (a, b) = (store.spawn(), store.spawn());
    let mut grid = cliff();
    for (h, x) in [(a, 1), (b, 2)] {
        let at = grid.shape().idx(Pos { x, y: 1 }).expect("inside");
        grid.link_thing(&store, h, at);
    }
    let swapped = |id| Some(if store.id(a) == Some(id) { b } else { a });
    assert_eq!(
        Grid::read(&mut Reader::new(&bytes(&grid)), &store, swapped).err(),
        Some(ImageError::Corrupt("placement of an absent entity"))
    );
}

#[test]
fn placement_records_ignore_slot_order() {
    let schema = SchemaBuilder::default().build();
    let travellers = || -> (Traveller, Traveller) {
        let mut source = Store::new(&schema, FloorId(0));
        let (x, y) = (source.spawn(), source.spawn());
        (source.detach(x), source.detach(y))
    };
    let image = |x: Traveller, y: Traveller, y_first: bool| {
        let mut store = Store::new(&schema, FloorId(1));
        let mut grid = cliff();
        let mut attach = |t| store.attach(t).expect("a detached row attaches");
        let (hx, hy) = if y_first {
            let hy = attach(y);
            (attach(x), hy)
        } else {
            let hx = attach(x);
            (hx, attach(y))
        };
        let at = |p| grid.shape().idx(p).expect("inside");
        let (p, q) = (at(Pos { x: 1, y: 1 }), at(Pos { x: 2, y: 2 }));
        grid.link_actor(&store, hx, p);
        grid.link_actor(&store, hy, q);
        bytes(&grid)
    };
    let (x1, y1) = travellers();
    let (x2, y2) = travellers();
    assert_eq!(image(x1, y1, false), image(x2, y2, true));
}

#[test]
fn repeated_id_is_corrupt() {
    let mut store = store();
    let (a, b) = (store.spawn(), store.spawn());
    let (p, q) = (Pos { x: 1, y: 1 }, Pos { x: 2, y: 2 });
    for records in [
        [(bits(&store, a), ACTOR, p), (bits(&store, a), THING, q)],
        [(bits(&store, b), ACTOR, p), (bits(&store, a), ACTOR, q)],
    ] {
        assert_eq!(
            read(&forged(&cliff(), &records), &store).err(),
            Some(ImageError::Corrupt("placement order")),
            "{records:?}"
        );
    }
}

#[test]
fn unknown_layer_is_corrupt() {
    let mut store = store();
    let h = store.spawn();
    assert_eq!(
        read(
            &forged(&cliff(), &[(bits(&store, h), 2, Pos { x: 1, y: 1 })]),
            &store
        )
        .err(),
        Some(ImageError::Corrupt("layer"))
    );
}

#[test]
fn record_id_bits_with_bit_63_set_are_corrupt() {
    let record = (1 << 63, ACTOR, Pos { x: 1, y: 1 });
    assert_eq!(
        read(&forged(&cliff(), &[record]), &store()).err(),
        Some(ImageError::Corrupt("entity id"))
    );
}
