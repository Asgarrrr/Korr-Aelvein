use std::num::NonZeroU32;

use korr_ecs::{FloorId, Handle, ImageError, Reader, SchemaBuilder, Store, Writer};
use korr_grid::{Dir, Grid, Layer, MAX_STEP, Material, Pos, Shape, StepError};
use korr_random::{DrawIndex, ModuleKey, Phase, Seed, Stream, Subject};

/// 256 interior cells: one per `i8` height.
const SIDE: u16 = 18;

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

fn read(
    bytes: &[u8],
    store: &Store,
    placed: impl IntoIterator<Item = (Handle, Pos, Layer)>,
) -> Result<Grid, ImageError> {
    Grid::read(&mut Reader::new(bytes), store, placed)
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
    let reloaded = read(&image, &store(), []).expect("own image reads");
    assert_eq!(bytes(&reloaded), image);
}

#[test]
fn every_strict_prefix_is_truncated() {
    let image = bytes(&seeded());
    let store = store();
    for n in 0..image.len() {
        assert!(
            matches!(
                read(&image[..n], &store, []),
                Err(ImageError::Truncated { .. })
            ),
            "{n}"
        );
    }
}

#[test]
fn huge_shape_without_layers_is_truncated() {
    let image = header(32_767, 32_767);
    assert!(matches!(
        read(&image, &store(), []),
        Err(ImageError::Truncated { .. })
    ));
}

#[test]
fn bad_side_is_corrupt() {
    let mut image = header(2, 3);
    image.extend_from_slice(&[1, 0]);
    assert_eq!(
        read(&image, &store(), []).err(),
        Some(ImageError::Corrupt("floor shape"))
    );
}

#[test]
fn unknown_material_is_corrupt() {
    let mut image = header(3, 3);
    image.extend_from_slice(&[2, 0]);
    assert_eq!(
        read(&image, &store(), []).err(),
        Some(ImageError::Corrupt("material"))
    );
}

#[test]
fn position_on_the_ring_is_corrupt() {
    let image = bytes(&cliff());
    let mut store = store();
    let h = store.spawn();
    for layer in [Layer::Actor, Layer::Thing] {
        assert_eq!(
            read(&image, &store, [(h, Pos { x: 0, y: 1 }, layer)]).err(),
            Some(ImageError::Corrupt("position off the floor")),
            "{layer:?}"
        );
    }
}

#[test]
fn rebuild_rejects_position_off_shape() {
    let image = bytes(&cliff());
    let mut store = store();
    let h = store.spawn();
    for p in [
        Pos { x: -1, y: 1 },
        Pos { x: 1, y: 4 },
        Pos { x: 99, y: 99 },
    ] {
        assert_eq!(
            read(&image, &store, [(h, p, Layer::Actor)]).err(),
            Some(ImageError::Corrupt("position off the floor")),
            "{p:?}"
        );
    }
}

#[test]
fn rebuild_accepts_actor_and_thing_on_wall() {
    let image = bytes(&cliff());
    let mut store = store();
    let (a, t) = (store.spawn(), store.spawn());
    let wall = Pos { x: 2, y: 1 };
    assert!(
        read(
            &image,
            &store,
            [(a, wall, Layer::Actor), (t, wall, Layer::Thing)]
        )
        .is_ok()
    );
}

#[test]
fn two_actors_on_one_cell_is_corrupt() {
    let image = bytes(&cliff());
    let mut store = store();
    let a = store.spawn();
    let b = store.spawn();
    let at = Pos { x: 1, y: 1 };
    assert_eq!(
        read(
            &image,
            &store,
            [(a, at, Layer::Actor), (b, at, Layer::Actor)]
        )
        .err(),
        Some(ImageError::Corrupt("two actors on one cell"))
    );
}

#[test]
fn rebuild_orders_things_by_id() {
    let image = bytes(&cliff());
    let mut store = store();
    let handles: Vec<Handle> = (0..4).map(|_| store.spawn()).collect();
    let at = Pos { x: 1, y: 1 };
    let grid = read(
        &image,
        &store,
        handles.iter().rev().map(|&h| (h, at, Layer::Thing)),
    )
    .expect("things on ground rebuild");
    let cell = grid.shape().idx(at).expect("inside").cell();
    assert_eq!(grid.things(cell).collect::<Vec<_>>(), handles);
}

#[test]
fn rebuilt_grid_steps_like_the_original() {
    let mut store = store();
    let h = store.spawn();
    let start = Pos { x: 1, y: 1 };
    let mut original = cliff();
    original.link_actor(&store, h, original.shape().idx(start).expect("inside"));
    let mut rebuilt =
        read(&bytes(&original), &store, [(h, start, Layer::Actor)]).expect("own image rebuilds");
    for (dir, expected) in [
        (Dir::East, Err(StepError::Blocked)),
        (Dir::South, Err(StepError::TooSteep)),
        (Dir::SouthEast, Ok(Pos { x: 2, y: 2 })),
    ] {
        assert_eq!(original.step(h, dir), expected, "{dir:?}");
        assert_eq!(rebuilt.step(h, dir), expected, "{dir:?}");
    }
}
