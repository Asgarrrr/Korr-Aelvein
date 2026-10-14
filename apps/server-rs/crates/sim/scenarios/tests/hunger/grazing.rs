use core::convert::Infallible;

use korr_contracts::{Graze, Plants};
use korr_core::host::{Round, SIGHT, Seed, Then, World, keyed};
use korr_core::mechanic::{
    Builder, CommitCtx, Module, Pos, PrepCtx, Prepared, Proposals, Provided, ReadCells, Senses,
    Served, Target, provides_cells, serves,
};
use korr_engine::Registry;
use korr_grid::Material;
use korr_hunger::config::{DECAY, FULL, PECKISH};
use korr_hunger::{Diet, Satiety};
use korr_scenarios::{Scripted, floor, game, hunger, plants, run, stomach};

use super::{MEADOW, grazing, herbivore, meadow, plant};

#[test]
fn a_hungry_creature_walks_to_a_plant_and_grazes_it() {
    let game = grazing(vec![]);
    let (food, more) = (Pos { x: 6, y: 4 }, Pos { x: 7, y: 4 });
    let (mut world, actors) = meadow(&game, 0, &[Pos { x: 4, y: 4 }], &[(food, 8), (more, 8)]);
    run(&game, &mut world, 1);
    assert_eq!(world.floor(MEADOW).pos(actors[0]), Some(Pos { x: 5, y: 4 }));
    assert_ne!(plant(&game, &world, food), 0);
    run(&game, &mut world, 1);
    assert_eq!(plant(&game, &world, food), 0);
    run(&game, &mut world, 1);
    // One ripe plant sates an empty stomach.
    assert_eq!(world.floor(MEADOW).pos(actors[0]), Some(Pos { x: 5, y: 4 }));
    assert_ne!(plant(&game, &world, more), 0);
}

#[test]
fn a_creature_approaches_a_plant_on_a_diagonal() {
    let game = grazing(vec![]);
    let (mut world, actors) = meadow(&game, 0, &[Pos { x: 6, y: 6 }], &[(Pos { x: 4, y: 4 }, 3)]);
    run(&game, &mut world, 1);
    assert_eq!(world.floor(MEADOW).pos(actors[0]), Some(Pos { x: 5, y: 5 }));
}

#[test]
fn a_wall_stops_the_approach() {
    let game = grazing(vec![]);
    let ruleset = game.ruleset();
    let (home, food) = (Pos { x: 4, y: 4 }, Pos { x: 6, y: 4 });
    let mut f = floor(ruleset, MEADOW, 9, 9);
    f.set_cell(ruleset, plants(&game.mechanics().1), food, 3);
    f.set_material(Pos { x: 5, y: 4 }, Material::WALL);
    let h = f.spawn_actor(ruleset, home);
    herbivore(&game, &mut f, h, 0);
    let mut world = World::new(vec![f]);
    run(&game, &mut world, 3);
    assert_eq!(world.floor(MEADOW).pos(h), Some(home));
    assert_ne!(plant(&game, &world, food), 0);
}

#[test]
fn a_plant_just_past_sight_is_neither_approached_nor_eaten() {
    let game = grazing(vec![]);
    let (home, food) = (
        Pos { x: 1, y: 4 },
        Pos {
            x: 2 + SIGHT.cast_signed(),
            y: 4,
        },
    );
    let (mut world, actors) = meadow(&game, 0, &[home], &[(food, 1)]);
    run(&game, &mut world, 3);
    assert_eq!(world.floor(MEADOW).pos(actors[0]), Some(home));
    assert_ne!(plant(&game, &world, food), 0);
}

/// The plant lies on the last interior row and column, where sight is clamped.
#[test]
fn a_plant_in_the_far_corner_of_the_floor_is_walked_to() {
    let game = grazing(vec![]);
    let corner = Pos { x: 7, y: 7 };
    let (mut world, actors) = meadow(&game, 0, &[Pos { x: 5, y: 5 }], &[(corner, 3)]);
    run(&game, &mut world, 1);
    assert_eq!(world.floor(MEADOW).pos(actors[0]), Some(Pos { x: 6, y: 6 }));
}

/// Serves `Graze` on the plants like flora, but refuses a seedling and
/// never grows a plant.
struct Picky {
    plants: ReadCells,
}

impl Picky {
    fn build(b: &mut Builder<'_>) -> Self {
        Self {
            plants: b.provide_cells::<Plants>(),
        }
    }
}

impl Module for Picky {
    const NAME: &'static str = "test.picky";
    const PROVIDES: &'static [Provided] = &[provides_cells::<Plants>()];
    const SERVES: Option<Served> =
        Some(serves::<Graze>(|plant| (plant > 1).then_some(plant), |_| 0));
    type Action = Infallible;
    type Plan = Infallible;

    fn propose(&self, _: &Senses<'_>, _: &mut Proposals<'_, Infallible>) {}

    fn prepare(
        &self,
        action: Infallible,
        _: Target,
        _: &PrepCtx<'_>,
    ) -> Prepared<Infallible, Infallible> {
        match action {}
    }

    fn commit(&self, plan: Infallible, _: &mut CommitCtx<'_>) {
        match plan {}
    }
}

#[test]
fn a_creature_does_not_approach_a_plant_its_server_refuses() {
    let registry = Registry {
        wander: false,
        flora: false,
        ..Registry::default()
    };
    let game = game(Then(keyed(Picky::build), registry), Seed(1));
    let ruleset = game.ruleset();
    let (home, seedling) = (Pos { x: 4, y: 4 }, Pos { x: 6, y: 4 });
    let mut f = floor(ruleset, MEADOW, 9, 9);
    f.set_cell(ruleset, game.mechanics().0.plants, seedling, 1);
    let h = f.spawn_actor(ruleset, home);
    stomach(&mut f, hunger(&game.mechanics().1), h, 0, Diet::PLANTS);
    let mut world = World::new(vec![f]);
    run(&game, &mut world, 2);
    assert_eq!(world.floor(MEADOW).pos(h), Some(home));
}

/// A ripe plant gives far more than a stomach holds, so the creature is
/// hungry again once `FULL` has decayed to `PECKISH`, not much later.
#[test]
fn a_stomach_never_holds_more_than_full() {
    let registry = Registry {
        wander: false,
        flora: false,
        ..Registry::default()
    };
    let game = game(Then(keyed(Picky::build), registry), Seed(1));
    let ruleset = game.ruleset();
    let (home, near, far) = (Pos { x: 4, y: 4 }, Pos { x: 5, y: 4 }, Pos { x: 7, y: 4 });
    let mut f = floor(ruleset, MEADOW, 9, 9);
    for at in [near, far] {
        f.set_cell(ruleset, game.mechanics().0.plants, at, u8::MAX);
    }
    let h = f.spawn_actor(ruleset, home);
    stomach(&mut f, hunger(&game.mechanics().1), h, 0, Diet::PLANTS);
    let mut world = World::new(vec![f]);
    run(&game, &mut world, u64::from((FULL - PECKISH) / DECAY) + 10);
    let cells = game.mechanics().0.plants;
    assert_eq!(world.floor(MEADOW).cell(ruleset, cells, near), 0);
    assert_eq!(world.floor(MEADOW).cell(ruleset, cells, far), 0);
}

#[test]
fn the_nearer_plant_is_eaten_first() {
    let game = grazing(vec![]);
    let (near, far) = (Pos { x: 5, y: 4 }, Pos { x: 7, y: 4 });
    let (mut world, _) = meadow(&game, 0, &[Pos { x: 4, y: 4 }], &[(near, 3), (far, 8)]);
    run(&game, &mut world, 1);
    assert_eq!(plant(&game, &world, near), 0);
    assert_ne!(plant(&game, &world, far), 0);
}

#[test]
fn of_two_plants_as_near_the_riper_is_eaten_first() {
    let game = grazing(vec![]);
    let (young, riper) = (Pos { x: 4, y: 2 }, Pos { x: 4, y: 6 });
    let (mut world, _) = meadow(&game, 0, &[Pos { x: 4, y: 4 }], &[(young, 2), (riper, 5)]);
    run(&game, &mut world, 2);
    assert_eq!(plant(&game, &world, riper), 0);
    assert_ne!(plant(&game, &world, young), 0);
}

#[test]
fn one_plant_feeds_one_of_two_creatures() {
    let game = grazing(vec![]);
    let (food, far) = (Pos { x: 4, y: 4 }, Pos { x: 4, y: 7 });
    let homes = [Pos { x: 3, y: 4 }, Pos { x: 5, y: 4 }];
    let (mut world, actors) = meadow(&game, 0, &homes, &[(food, 7), (far, 7)]);
    run(&game, &mut world, 1);
    assert_eq!(plant(&game, &world, food), 0);
    run(&game, &mut world, 1);
    // The fed one is sated; the other heads for the far plant.
    let moved = actors
        .iter()
        .zip(homes)
        .filter(|&(&h, home)| world.floor(MEADOW).pos(h) != Some(home))
        .count();
    assert_eq!(moved, 1);
}

#[test]
fn without_flora_a_hungry_creature_stays_put() {
    let registry = Registry {
        wander: false,
        flora: false,
        ..Registry::default()
    };
    let game = game(Then(Scripted(vec![]), registry), Seed(1));
    let home = Pos { x: 4, y: 4 };
    let (mut world, actors) = meadow(&game, 0, &[home], &[]);
    run(&game, &mut world, 10);
    assert_eq!(world.floor(MEADOW).pos(actors[0]), Some(home));
    assert_eq!(world.floor(MEADOW).round(), Round(10));
}

#[test]
fn a_creature_without_a_diet_never_grazes() {
    let game = grazing(vec![]);
    let ruleset = game.ruleset();
    let food = Pos { x: 5, y: 4 };
    let mut f = floor(ruleset, MEADOW, 9, 9);
    f.set_cell(ruleset, plants(&game.mechanics().1), food, 3);
    let h = f.spawn_actor(ruleset, Pos { x: 4, y: 4 });
    f.init(hunger(&game.mechanics().1).satiety(), h, Satiety(0));
    let mut world = World::new(vec![f]);
    run(&game, &mut world, 2);
    assert_ne!(plant(&game, &world, food), 0);
}
