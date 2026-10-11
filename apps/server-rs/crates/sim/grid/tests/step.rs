use korr_ecs::{FloorId, Handle, SchemaBuilder, Store};
use korr_grid::{Dir, Grid, MAX_STEP, Material, Pos, Shape, StepError};

fn shape(width: u16, height: u16) -> Shape {
    Shape::new(width, height).expect("test shapes fit the bounds")
}

fn place(shape: Shape, p: Pos) -> (Grid, Handle) {
    let mut store = Store::new(&SchemaBuilder::default().build(), FloorId(0));
    let h = store.spawn();
    let mut grid = Grid::new(shape);
    let at = shape.idx(p).expect("the actor starts inside");
    grid.link_actor(&store, h, at);
    (grid, h)
}

fn place_all(shape: Shape, ps: &[Pos]) -> (Grid, Vec<Handle>) {
    let mut store = Store::new(&SchemaBuilder::default().build(), FloorId(0));
    let mut grid = Grid::new(shape);
    let handles = ps
        .iter()
        .map(|&p| {
            let h = store.spawn();
            let at = shape.idx(p).expect("every actor starts inside");
            grid.link_actor(&store, h, at);
            h
        })
        .collect();
    (grid, handles)
}

fn set_material(grid: &mut Grid, p: Pos, m: Material) {
    let at = grid.shape().idx(p).expect("the edited cell is inside");
    grid.set_material(at, m);
}

fn set_height(grid: &mut Grid, p: Pos, h: i8) {
    let at = grid.shape().idx(p).expect("the edited cell is inside");
    grid.set_height(at, h);
}

fn max_step() -> i8 {
    i8::try_from(MAX_STEP).expect("MAX_STEP fits i8")
}

fn actor_at(grid: &Grid, p: Pos) -> Option<Handle> {
    let at = grid.shape().idx(p).expect("the probe is inside");
    grid.actor_at(at.cell())
}

#[test]
fn actor_steps_east_until_the_ring_blocks() {
    let shape = shape(6, 3);
    let (mut grid, h) = place(shape, Pos { x: 1, y: 1 });
    for x in 2..=4 {
        assert_eq!(grid.step(h, Dir::East), Ok(Pos { x, y: 1 }));
        assert_eq!(actor_at(&grid, Pos { x: x - 1, y: 1 }), None);
        assert_eq!(actor_at(&grid, Pos { x, y: 1 }), Some(h));
    }
    assert_eq!(grid.step(h, Dir::East), Err(StepError::Blocked));
    assert_eq!(actor_at(&grid, Pos { x: 4, y: 1 }), Some(h));
}

#[test]
fn every_direction_from_every_interior_cell() {
    let shape = shape(5, 4);
    for y in 1..=2 {
        for x in 1..=3 {
            let from = Pos { x, y };
            for dir in Dir::ALL {
                let (dx, dy) = dir.offset();
                let to = Pos {
                    x: x + dx,
                    y: y + dy,
                };
                let (mut grid, h) = place(shape, from);
                let result = grid.step(h, dir);
                if shape.idx(to).is_some() {
                    assert_eq!(result, Ok(to), "{from:?} {dir:?}");
                    assert_eq!(actor_at(&grid, to), Some(h), "{from:?} {dir:?}");
                } else {
                    assert_eq!(result, Err(StepError::Blocked), "{from:?} {dir:?}");
                    assert_eq!(actor_at(&grid, from), Some(h), "{from:?} {dir:?}");
                }
            }
        }
    }
}

const A: Pos = Pos { x: 1, y: 1 };
const EAST_OF_A: Pos = Pos { x: 2, y: 1 };

#[test]
fn interior_wall_blocks() {
    let (mut grid, h) = place(shape(5, 3), A);
    set_material(&mut grid, EAST_OF_A, Material::WALL);
    assert_eq!(grid.step(h, Dir::East), Err(StepError::Blocked));
    assert_eq!(actor_at(&grid, A), Some(h));
}

#[test]
fn height_step_above_max_step_is_too_steep() {
    let legal = max_step();
    let steep = legal + 1;
    for (target, expected) in [
        (legal, Ok(EAST_OF_A)),
        (-legal, Ok(EAST_OF_A)),
        (steep, Err(StepError::TooSteep)),
        (-steep, Err(StepError::TooSteep)),
    ] {
        let (mut grid, h) = place(shape(5, 3), A);
        set_height(&mut grid, EAST_OF_A, target);
        assert_eq!(grid.step(h, Dir::East), expected, "target height {target}");
    }
}

#[test]
fn extreme_heights_do_not_overflow() {
    for (from, to) in [(i8::MAX, i8::MIN), (i8::MIN, i8::MAX)] {
        let (mut grid, h) = place(shape(5, 3), A);
        set_height(&mut grid, A, from);
        set_height(&mut grid, EAST_OF_A, to);
        assert_eq!(
            grid.step(h, Dir::East),
            Err(StepError::TooSteep),
            "{from} to {to}"
        );
    }
}

#[test]
fn blocked_beats_too_steep_beats_occupied() {
    let (mut grid, actors) = place_all(shape(5, 3), &[A, EAST_OF_A]);
    let a = actors[0];
    set_material(&mut grid, EAST_OF_A, Material::WALL);
    set_height(&mut grid, EAST_OF_A, max_step() + 1);
    assert_eq!(grid.step(a, Dir::East), Err(StepError::Blocked));
    set_material(&mut grid, EAST_OF_A, Material::GROUND);
    assert_eq!(grid.step(a, Dir::East), Err(StepError::TooSteep));
    set_height(&mut grid, EAST_OF_A, 0);
    assert_eq!(grid.step(a, Dir::East), Err(StepError::Occupied));
}

#[test]
fn errors_leave_the_grid_unchanged() {
    let from = Pos { x: 2, y: 1 };
    let wall = Pos { x: 1, y: 1 };
    let steep = Pos { x: 3, y: 1 };
    let held = Pos { x: 2, y: 2 };
    let (mut grid, actors) = place_all(shape(6, 4), &[from, held]);
    let (a, b) = (actors[0], actors[1]);
    set_material(&mut grid, wall, Material::WALL);
    set_height(&mut grid, steep, max_step() + 1);
    assert_eq!(grid.step(a, Dir::West), Err(StepError::Blocked));
    assert_eq!(grid.step(a, Dir::East), Err(StepError::TooSteep));
    assert_eq!(grid.step(a, Dir::South), Err(StepError::Occupied));
    assert_eq!(actor_at(&grid, from), Some(a));
    assert_eq!(actor_at(&grid, wall), None);
    assert_eq!(actor_at(&grid, steep), None);
    assert_eq!(actor_at(&grid, held), Some(b));
    assert_eq!(grid.step(a, Dir::SouthEast), Ok(Pos { x: 3, y: 2 }));
}

#[test]
fn occupied_by_another_actor() {
    let (mut grid, actors) = place_all(shape(5, 3), &[A, EAST_OF_A]);
    let (a, b) = (actors[0], actors[1]);
    assert_eq!(grid.step(a, Dir::East), Err(StepError::Occupied));
    assert_eq!(grid.step(b, Dir::West), Err(StepError::Occupied));
    assert_eq!(actor_at(&grid, A), Some(a));
    assert_eq!(actor_at(&grid, EAST_OF_A), Some(b));
}
