use core::convert::Infallible;

use korr_contracts::{Graze, Plants};
use korr_core::{
    host::{Both, Floor, Game, Round, SIGHT, Seed, Then, World, keyed},
    mechanic::{
        Band, Builder, CommitCtx, Component, Dir, ImageError, Module, Pos, PrepCtx, Prepared,
        Proposals, Provided, ReadCells, Reader, Senses, Served, Target, provides_cells, serves,
    },
};
use korr_ecs::{FloorId, Handle};
use korr_engine::{Modules, Registry};
use korr_grid::Material;
use korr_hunger::config::{DECAY, PECKISH, STARVING};
use korr_hunger::{Diet, Satiety};
use korr_scenarios::{Act, Answer, Fake, Scripted, floor, game, hunger, plants, run, stomach};

#[test]
fn a_diet_reads_back_its_foods() {
    assert_eq!(Diet::read(&mut Reader::new(&[3])), Ok(Diet::ALL));
}

#[test]
fn a_diet_with_an_unknown_food_is_corrupt() {
    assert_eq!(
        Diet::read(&mut Reader::new(&[4])),
        Err(ImageError::Corrupt("diet"))
    );
}

#[test]
fn a_diet_with_a_known_and_an_unknown_food_is_corrupt() {
    // Plants, and an unknown food.
    assert_eq!(
        Diet::read(&mut Reader::new(&[5])),
        Err(ImageError::Corrupt("diet"))
    );
}

#[test]
fn satiety_survives_a_save() {
    let game = grazing(vec![]);
    let plant = [(Pos { x: 6, y: 4 }, 3)];
    let start = || meadow(&game, PECKISH + 5 * DECAY, &[Pos { x: 4, y: 4 }], &plant).0;
    let mut uninterrupted = start();
    run(&game, &mut uninterrupted, 4);
    let world = start();
    let mut world = game.load(&game.save(&world)).expect("own save loads");
    run(&game, &mut world, 2);
    let mut world = game.load(&game.save(&world)).expect("own save loads");
    run(&game, &mut world, 2);
    assert_eq!(game.hash(&world), game.hash(&uninterrupted));
}

#[test]
fn the_game_runs_without_hunger() {
    let game = game(
        Registry {
            hunger: false,
            ..Registry::default()
        },
        Seed(1),
    );
    let mut f: Floor = floor(game.ruleset(), FloorId(0), 6, 6);
    f.spawn_actor(game.ruleset(), Pos { x: 2, y: 2 });
    let mut world = World::new(vec![f]);
    run(&game, &mut world, 20);
    assert_eq!(world.floor(FloorId(0)).round(), Round(20));
}

const MEADOW: FloorId = FloorId(0);

type Grazing = Game<Both<Scripted, Modules>>;

/// The registry without wander, after a module that proposes `script`.
fn grazing(script: Vec<Act>) -> Grazing {
    let registry = Registry {
        wander: false,
        ..Registry::default()
    };
    game(Then(Scripted(script), registry), Seed(1))
}

/// Plants at `satiety` and a herbivore's diet on `h`.
fn herbivore(game: &Grazing, f: &mut Floor, h: Handle, satiety: u16) {
    stomach(f, hunger(&game.mechanics().1), h, satiety, Diet::PLANTS);
}

/// A 9x9 floor holding `plants` and one actor at each of `actors`, every
/// actor at `satiety`.
fn meadow(
    game: &Grazing,
    satiety: u16,
    actors: &[Pos],
    plants: &[(Pos, u8)],
) -> (World, Vec<Handle>) {
    let ruleset = game.ruleset();
    let mut f = floor(ruleset, MEADOW, 9, 9);
    for &(at, growth) in plants {
        f.set_cell(
            ruleset,
            korr_scenarios::plants(&game.mechanics().1),
            at,
            growth,
        );
    }
    let handles = actors
        .iter()
        .map(|&at| {
            let h = f.spawn_actor(ruleset, at);
            herbivore(game, &mut f, h, satiety);
            h
        })
        .collect();
    (World::new(vec![f]), handles)
}

fn plant(game: &Grazing, world: &World, at: Pos) -> u8 {
    world
        .floor(MEADOW)
        .cell(game.ruleset(), plants(&game.mechanics().1), at)
}

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

/// A rival that stays put against the wall north of a creature on the top row.
fn rival(band: Band, weight: u16) -> Vec<Act> {
    vec![Act {
        action: Fake::X,
        band,
        weight,
        target: Target::None,
        answer: Answer::Go(Dir::North),
    }]
}

/// Whether a creature at `satiety` before the round's decay grazes the
/// plant beside it over a rival.
fn grazes_over(satiety: u16, rival: Vec<Act>) -> bool {
    let game = grazing(rival);
    let food = Pos { x: 5, y: 1 };
    let (mut world, _) = meadow(&game, satiety, &[Pos { x: 4, y: 1 }], &[(food, 3)]);
    run(&game, &mut world, 1);
    plant(&game, &world, food) == 0
}

#[test]
fn a_sated_creature_does_not_graze() {
    assert!(!grazes_over(PECKISH + DECAY, vec![]));
}

#[test]
fn one_point_below_peckish_grazes() {
    assert!(grazes_over(PECKISH - 1 + DECAY, vec![]));
}

#[test]
fn hunger_outweighs_a_routine_as_satiety_falls() {
    assert!(!grazes_over(
        PECKISH - 50 + DECAY,
        rival(Band::Routine, 100)
    ));
    assert!(grazes_over(STARVING + DECAY, rival(Band::Routine, 100)));
}

#[test]
fn an_empty_stomach_outweighs_a_lighter_vigilance() {
    assert!(grazes_over(
        DECAY,
        rival(Band::Vigilance, u16::from(u8::MAX) - 1)
    ));
}

#[test]
fn a_starving_creature_grazes_before_any_routine() {
    assert!(grazes_over(0, rival(Band::Routine, u16::MAX)));
}

#[test]
fn a_creature_at_the_starving_line_keeps_to_its_routine() {
    assert!(!grazes_over(
        STARVING + DECAY,
        rival(Band::Routine, u16::MAX)
    ));
}

#[test]
fn one_point_below_the_starving_line_grazes_before_any_routine() {
    assert!(grazes_over(
        STARVING - 1 + DECAY,
        rival(Band::Routine, u16::MAX)
    ));
}
