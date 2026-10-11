use std::panic::{AssertUnwindSafe, catch_unwind};

use korr_ecs::{FloorId, Handle, SchemaBuilder, Store};
use korr_grid::{Dir, Grid, Interior, Pos, Shape};

fn setup() -> (Store, Grid) {
    let store = Store::new(&SchemaBuilder::default().build(), FloorId(0));
    let shape = Shape::new(3, 3).expect("3x3 fits the bounds");
    (store, Grid::new(shape))
}

#[test]
#[should_panic(expected = "step of an entity that is not a linked actor")]
fn step_of_an_unlinked_handle_panics() {
    let (mut store, mut grid) = setup();
    let h = store.spawn();
    let _result = grid.step(h, Dir::East);
}

#[test]
#[should_panic(expected = "cell already holds an actor")]
fn linking_onto_an_actor_panics() {
    let (mut store, mut grid) = setup();
    let a = store.spawn();
    let b = store.spawn();
    let at = grid
        .shape()
        .idx(Pos { x: 1, y: 1 })
        .expect("the centre is inside");
    grid.link_actor(a, store.id(a).expect("a spawned handle is alive"), at);
    grid.link_actor(b, store.id(b).expect("a spawned handle is alive"), at);
}

#[test]
#[should_panic(expected = "slot still linked: unlink before despawn or detach")]
fn linking_a_linked_handle_panics() {
    let (mut store, mut grid) = setup();
    let h = store.spawn();
    let at = grid
        .shape()
        .idx(Pos { x: 1, y: 1 })
        .expect("the centre is inside");
    grid.link_actor(h, store.id(h).expect("a spawned handle is alive"), at);
    grid.link_actor(h, store.id(h).expect("a spawned handle is alive"), at);
}

const WEST: Pos = Pos { x: 1, y: 1 };
const EAST: Pos = Pos { x: 2, y: 1 };

fn setup_wide() -> (Store, Grid) {
    let store = Store::new(&SchemaBuilder::default().build(), FloorId(0));
    let shape = Shape::new(4, 3).expect("4x3 fits the bounds");
    (store, Grid::new(shape))
}

fn interior(grid: &Grid, p: Pos) -> Interior {
    grid.shape().idx(p).expect("the probe is inside")
}

/// A linked at `WEST`, unlinked and despawned; B linked at `EAST` on A's slot.
fn recycled() -> (Grid, Handle, Handle) {
    let (mut store, mut grid) = setup_wide();
    let a = store.spawn();
    grid.link_actor(
        a,
        store.id(a).expect("a spawned handle is alive"),
        interior(&grid, WEST),
    );
    grid.unlink(a);
    store.despawn(a);
    let b = store.spawn();
    assert_eq!(b.slot(), a.slot(), "the store recycles A's slot");
    grid.link_actor(
        b,
        store.id(b).expect("a spawned handle is alive"),
        interior(&grid, EAST),
    );
    (grid, a, b)
}

#[test]
#[should_panic(expected = "entity not linked on this grid")]
fn unlink_of_an_unlinked_handle_panics() {
    let (mut store, mut grid) = setup();
    let h = store.spawn();
    grid.unlink(h);
}

#[test]
fn stale_unlink_panics_and_keeps_the_new_holder() {
    let (mut grid, a, b) = recycled();
    assert!(catch_unwind(AssertUnwindSafe(|| grid.unlink(a))).is_err());
    assert_eq!(grid.actor_at(interior(&grid, EAST).cell()), Some(b));
}

#[test]
fn stale_step_panics_and_keeps_the_new_holder() {
    let (mut grid, a, b) = recycled();
    assert!(catch_unwind(AssertUnwindSafe(|| grid.step(a, Dir::West))).is_err());
    assert_eq!(grid.actor_at(interior(&grid, EAST).cell()), Some(b));
    assert_eq!(grid.actor_at(interior(&grid, WEST).cell()), None);
}

#[test]
#[should_panic(expected = "slot still linked: unlink before despawn or detach")]
fn despawn_without_unlink_is_caught_when_the_slot_returns() {
    let (mut store, mut grid) = setup_wide();
    let a = store.spawn();
    grid.link_actor(
        a,
        store.id(a).expect("a spawned handle is alive"),
        interior(&grid, WEST),
    );
    store.despawn(a);
    let b = store.spawn();
    assert_eq!(b.slot(), a.slot(), "the store recycles A's slot");
    grid.link_actor(
        b,
        store.id(b).expect("a spawned handle is alive"),
        interior(&grid, EAST),
    );
}

#[test]
fn pos_follows_link_step_and_unlink() {
    let (mut store, mut grid) = setup_wide();
    let actor = store.spawn();
    let thing = store.spawn();
    assert_eq!(grid.pos(actor), None);
    grid.link_actor(
        actor,
        store.id(actor).expect("a spawned handle is alive"),
        interior(&grid, WEST),
    );
    grid.link_thing(
        thing,
        store.id(thing).expect("a spawned handle is alive"),
        interior(&grid, EAST),
    );
    assert_eq!(grid.pos(actor), Some(WEST));
    assert_eq!(grid.pos(thing), Some(EAST));
    assert_eq!(grid.step(actor, Dir::East), Ok(EAST));
    assert_eq!(grid.pos(actor), Some(EAST));
    grid.unlink(actor);
    assert_eq!(grid.pos(actor), None);

    let (grid, stale, holder) = recycled();
    assert_eq!(grid.pos(stale), None);
    assert_eq!(grid.pos(holder), Some(EAST));
}
