use korr_ecs::{FloorId, SchemaBuilder, Store};
use korr_grid::{Grid, Interior, Layer, Material, Pos, Shape};

fn grid(width: u16, height: u16) -> Grid {
    Grid::new(Shape::new(width, height).expect("test shapes fit the bounds"))
}

fn store() -> Store {
    Store::new(&SchemaBuilder::default().build(), FloorId(0))
}

fn at(grid: &Grid, x: i16, y: i16) -> Interior {
    grid.shape().idx(Pos { x, y }).expect("the probe is inside")
}

fn place(grid: &Grid, from: Pos, layer: Layer) -> Option<Pos> {
    grid.nearest_place(from, layer)
        .map(|at| grid.shape().pos(at.cell()))
}

fn link_actor(grid: &mut Grid, store: &mut Store, x: i16, y: i16) {
    let h = store.spawn();
    let at = at(grid, x, y);
    grid.link_actor(store, h, at);
}

const CENTRE: Pos = Pos { x: 3, y: 3 };

#[test]
fn off_floor_centre_is_clamped() {
    let grid = grid(12, 9);
    assert_eq!(
        place(&grid, Pos { x: -5, y: 100 }, Layer::Actor),
        Some(Pos { x: 1, y: 7 })
    );
}

#[test]
fn nearest_place_skips_walls_and_actors() {
    let mut grid = grid(7, 7);
    let mut store = store();
    link_actor(&mut grid, &mut store, 3, 3);
    link_actor(&mut grid, &mut store, 2, 2);
    grid.set_material(at(&grid, 3, 2), Material::WALL);
    assert_eq!(place(&grid, CENTRE, Layer::Actor), Some(Pos { x: 4, y: 2 }));
    assert_eq!(place(&grid, CENTRE, Layer::Thing), Some(CENTRE));
}

#[test]
fn nearest_place_skips_walls() {
    let mut grid = grid(7, 7);
    for (x, y) in [(3, 3), (2, 2)] {
        grid.set_material(at(&grid, x, y), Material::WALL);
    }
    for layer in [Layer::Actor, Layer::Thing] {
        assert_eq!(place(&grid, CENTRE, layer), Some(Pos { x: 3, y: 2 }));
    }
}

#[test]
fn can_place_refuses_wall() {
    let mut grid = grid(5, 5);
    let wall = at(&grid, 1, 1);
    let ground = at(&grid, 2, 1);
    grid.set_material(wall, Material::WALL);
    for layer in [Layer::Actor, Layer::Thing] {
        assert!(!grid.can_place(wall, layer));
        assert!(grid.can_place(ground, layer));
    }
}

#[test]
fn full_floor_refuses_actors_but_takes_things() {
    let mut grid = grid(5, 5);
    let mut store = store();
    for y in 1..=3 {
        for x in 1..=3 {
            link_actor(&mut grid, &mut store, x, y);
        }
    }
    let from = Pos { x: 10, y: -3 };
    assert_eq!(place(&grid, from, Layer::Actor), None);
    assert_eq!(place(&grid, from, Layer::Thing), Some(Pos { x: 3, y: 1 }));
}

/// (1, 2) on 10x10 is index 21, which is the interior cell (3, 3) on 6x6.
fn aliasing() -> Interior {
    Shape::new(10, 10)
        .expect("10x10 fits the bounds")
        .idx(Pos { x: 1, y: 2 })
        .expect("(1, 2) is inside 10x10")
}

#[test]
#[should_panic(expected = "cell of another floor")]
fn aliasing_cell_write_panics() {
    grid(6, 6).set_material(aliasing(), Material::WALL);
}

#[test]
#[should_panic(expected = "cell of another floor")]
fn aliasing_cell_read_panics() {
    let _ = grid(6, 6).actor_at(aliasing().cell());
}

#[test]
#[should_panic(expected = "cell of another floor")]
fn aliasing_cell_pos_panics() {
    let _ = grid(6, 6).shape().pos(aliasing().cell());
}

#[test]
#[should_panic(expected = "cell of another floor")]
fn aliasing_cell_can_place_panics() {
    let _ = grid(6, 6).can_place(aliasing(), Layer::Actor);
}

#[test]
#[should_panic(expected = "cell of another floor")]
fn aliasing_cell_link_panics() {
    let mut store = store();
    let h = store.spawn();
    grid(6, 6).link_thing(&store, h, aliasing());
}

#[test]
fn holds_actor_follows_link_and_unlink() {
    let mut store = store();
    let mut grid = grid(5, 5);
    let cell = at(&grid, 2, 2);
    let h = store.spawn();
    assert!(!grid.holds_actor(cell.cell()));
    grid.link_actor(&store, h, cell);
    assert!(grid.holds_actor(cell.cell()));
    grid.unlink(h);
    assert!(!grid.holds_actor(cell.cell()));
}

#[test]
fn neighbourhood_is_the_interior_sorted_by_ring_then_row() {
    let shape = Shape::new(9, 7).expect("9x7 fits the bounds");
    for (cx, cy) in [(4, 3), (1, 1), (7, 5), (0, 9), (-3, -2), (12, 3)] {
        let centre = Pos { x: cx, y: cy };
        let ring = |p: Pos| (p.x - cx).abs().max((p.y - cy).abs());
        for radius in 0..12_u16 {
            let mut expected: Vec<Pos> = (1..6)
                .flat_map(|y| (1..8).map(move |x| Pos { x, y }))
                .filter(|&p| ring(p) <= i16::try_from(radius).expect("small"))
                .collect();
            expected.sort_unstable_by_key(|&p| (ring(p), p.y, p.x));
            let found: Vec<Pos> = shape
                .neighbourhood(centre, radius)
                .map(|at| shape.pos(at.cell()))
                .collect();
            assert_eq!(found, expected, "centre {centre:?}, radius {radius}");
        }
    }
}
