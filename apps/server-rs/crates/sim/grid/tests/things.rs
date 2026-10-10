use korr_ecs::{FloorId, Handle, SchemaBuilder, Store};
use korr_grid::{Dir, Grid, Interior, Pos, Shape};

const WEST: Pos = Pos { x: 1, y: 1 };
const EAST: Pos = Pos { x: 2, y: 1 };

fn setup() -> (Store, Grid) {
    let store = Store::new(&SchemaBuilder::default().build(), FloorId(0));
    let shape = Shape::new(4, 3).expect("4x3 fits the bounds");
    (store, Grid::new(shape))
}

fn interior(grid: &Grid, p: Pos) -> Interior {
    grid.shape().idx(p).expect("the probe is inside")
}

fn things(grid: &Grid, p: Pos) -> Vec<Handle> {
    grid.things(interior(grid, p).cell()).collect()
}

#[test]
fn things_iterate_in_ascending_id_after_slot_recycling() {
    let (mut store, mut grid) = setup();
    let at = interior(&grid, WEST);
    let t1 = store.spawn();
    let t2 = store.spawn();
    let t3 = store.spawn();
    for t in [t3, t1, t2] {
        grid.link_thing(&store, t, at);
    }
    assert_eq!(things(&grid, WEST), [t1, t2, t3]);
    grid.unlink(t1);
    store.despawn(t1);
    let t4 = store.spawn();
    assert_eq!(t4.slot(), t1.slot(), "the store recycles t1's slot");
    grid.link_thing(&store, t4, at);
    assert_eq!(things(&grid, WEST), [t2, t3, t4]);
}

#[test]
fn unlink_of_a_middle_thing_keeps_the_others_in_order() {
    let (mut store, mut grid) = setup();
    let at = interior(&grid, WEST);
    let t: Vec<Handle> = (0..6).map(|_| store.spawn()).collect();
    for &h in &t {
        grid.link_thing(&store, h, at);
    }
    for (removed, left) in [
        (t[2], vec![t[0], t[1], t[3], t[4], t[5]]),
        (t[3], vec![t[0], t[1], t[4], t[5]]),
        (t[0], vec![t[1], t[4], t[5]]),
        (t[1], vec![t[4], t[5]]),
        (t[5], vec![t[4]]),
        (t[4], vec![]),
    ] {
        grid.unlink(removed);
        assert_eq!(things(&grid, WEST), left);
    }
}

#[test]
fn things_do_not_block_a_step() {
    let (mut store, mut grid) = setup();
    let a = store.spawn();
    let t = store.spawn();
    grid.link_actor(&store, a, interior(&grid, WEST));
    grid.link_thing(&store, t, interior(&grid, EAST));
    assert_eq!(grid.step(a, Dir::East), Ok(EAST));
    assert_eq!(grid.actor_at(interior(&grid, EAST).cell()), Some(a));
    assert_eq!(things(&grid, EAST), [t]);
}

#[test]
fn actor_and_things_share_a_cell() {
    let (mut store, mut grid) = setup();
    let at = interior(&grid, WEST);
    let t1 = store.spawn();
    let a = store.spawn();
    let t2 = store.spawn();
    grid.link_thing(&store, t1, at);
    grid.link_actor(&store, a, at);
    grid.link_thing(&store, t2, at);
    assert_eq!(grid.actor_at(at.cell()), Some(a));
    assert_eq!(things(&grid, WEST), [t1, t2]);
    grid.unlink(t1);
    assert_eq!(grid.actor_at(at.cell()), Some(a));
    assert_eq!(things(&grid, WEST), [t2]);
    grid.unlink(a);
    assert_eq!(grid.actor_at(at.cell()), None);
    assert_eq!(things(&grid, WEST), [t2]);
}

#[test]
#[should_panic(expected = "step of an entity that is not a linked actor")]
fn step_of_a_thing_panics() {
    let (mut store, mut grid) = setup();
    let t = store.spawn();
    grid.link_thing(&store, t, interior(&grid, WEST));
    let _result = grid.step(t, Dir::East);
}
