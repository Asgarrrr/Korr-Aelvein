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
fn neighbourhood_scans_ring_by_ring_row_major() {
    let shape = Shape::new(7, 7).expect("7x7 fits the bounds");
    let scan = |radius| -> Vec<(i16, i16)> {
        shape
            .neighbourhood(CENTRE, radius)
            .map(|at| shape.pos(at.cell()))
            .map(|p| (p.x, p.y))
            .collect()
    };
    let ring_1 = [
        (3, 3),
        (2, 2),
        (3, 2),
        (4, 2),
        (2, 3),
        (4, 3),
        (2, 4),
        (3, 4),
        (4, 4),
    ];
    assert_eq!(scan(1), ring_1);
    assert_eq!(scan(2)[..ring_1.len()], ring_1);
}

#[test]
fn neighbourhood_clips_at_the_ring() {
    let shape = Shape::new(12, 9).expect("12x9 fits the bounds");
    let cells: Vec<Pos> = shape
        .neighbourhood(Pos { x: 1, y: 1 }, 4)
        .map(|at| shape.pos(at.cell()))
        .collect();
    let mut sorted: Vec<(i16, i16)> = cells.iter().map(|p| (p.y, p.x)).collect();
    sorted.sort_unstable();
    let square: Vec<(i16, i16)> = (1..=5).flat_map(|y| (1..=5).map(move |x| (y, x))).collect();
    assert_eq!(sorted, square);
    let distance = |p: &Pos| (p.x - 1).max(p.y - 1);
    assert!(
        cells
            .windows(2)
            .all(|pair| distance(&pair[0]) <= distance(&pair[1])),
        "{cells:?}"
    );
}

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

#[test]
#[should_panic(expected = "cell outside this floor's interior")]
fn foreign_cell_index_panics() {
    let foreign = Shape::new(10, 10)
        .expect("10x10 fits the bounds")
        .idx(Pos { x: 5, y: 1 })
        .expect("(5, 1) is inside 10x10");
    let mut grid = grid(5, 5);
    assert_eq!(grid.shape().pos(foreign.cell()), Pos { x: 0, y: 3 });
    grid.set_material(foreign, Material::GROUND);
}
