use core::convert::Infallible;
#[expect(
    clippy::disallowed_types,
    reason = "a test observer, not engine state: it only records what propose is shown"
)]
use std::sync::Mutex;

use korr_contracts::Appetite;
use korr_core::{
    host::{Both, Floor, Game, Mechanics, Recipe, Round, Seed, Then, World, keyed},
    mechanic::{
        Band, Builder, CommitCtx, Contract, Dir, Module, Pos, PrepCtx, Prepared, Proposals, Read,
        Senses, Target,
    },
};
use korr_ecs::{FloorId, Handle};
use korr_engine::{Modules, Registry};
use korr_grid::Material;
use korr_hunger::config::{DECAY, PECKISH, STARVING};
use korr_hunger::{Hunger, Satiety};
use korr_scenarios::{Act, Answer, Fake, Scripted, floor, game, run};

const HERBIVORE: Appetite = Appetite {
    urgency: 0,
    eats: Appetite::PLANTS,
};

/// Proposes nothing and records the urgency each actor holds, in turn order.
#[derive(Debug)]
#[expect(
    clippy::disallowed_types,
    reason = "a test observer, not engine state: it only records what propose is shown"
)]
struct Glutton {
    appetite: Option<Read<Appetite>>,
    seen: Mutex<Vec<Option<u8>>>,
}

impl Glutton {
    #[expect(
        clippy::disallowed_types,
        reason = "a test observer, not engine state: it only records what propose is shown"
    )]
    fn build(b: &mut Builder<'_>) -> Self {
        Self {
            appetite: b.contract(),
            seen: Mutex::default(),
        }
    }
}

impl Module for Glutton {
    const NAME: &'static str = "glutton";
    type Action = Infallible;
    type Plan = Infallible;

    fn propose(&self, senses: &Senses<'_>, _: &mut Proposals<'_, Infallible>) {
        let urgency = self
            .appetite
            .and_then(|key| senses.get(key))
            .map(|a| a.urgency);
        self.seen
            .lock()
            .expect("no propose panicked while holding the lock")
            .push(urgency);
    }

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

type Watched = Game<Both<Glutton, Hunger>>;

fn watched() -> Watched {
    game(Then(keyed(Glutton::build), keyed(Hunger::build)), Seed(1))
}

/// One actor that idles a round per turn: its turn in round r follows r hunger ticks.
fn hungry(game: &Watched, satiety: u16) -> World {
    let ruleset = game.ruleset();
    let mut f = floor(ruleset, FloorId(0), 5, 5);
    let h = f.spawn_actor(ruleset, Pos { x: 2, y: 2 });
    f.init(ruleset, h, "hunger.satiety", Satiety(satiety));
    f.init(ruleset, h, Appetite::NAME, HERBIVORE);
    World::new(vec![f])
}

fn recorded(game: &Watched) -> Vec<Option<u8>> {
    std::mem::take(
        &mut *game
            .mechanics()
            .0
            .seen
            .lock()
            .expect("no propose panicked while holding the lock"),
    )
}

fn urgencies(satiety: u16, rounds: u64) -> Vec<Option<u8>> {
    let game = watched();
    let mut world = hungry(&game, satiety);
    run(&game, &mut world, rounds);
    recorded(&game)
}

#[test]
fn a_sated_creature_has_no_urgency() {
    assert_eq!(urgencies(PECKISH + DECAY, 1), [Some(0)]);
}

#[test]
fn one_point_below_peckish_is_urgent() {
    let [Some(urgency)] = urgencies(PECKISH - 1 + DECAY, 1)[..] else {
        panic!("one turn, one appetite");
    };
    assert!(urgency >= 1);
}

#[test]
fn an_empty_stomach_is_fully_urgent() {
    assert_eq!(urgencies(DECAY, 1), [Some(u8::MAX)]);
}

#[test]
fn satiety_never_wraps_below_zero() {
    assert_eq!(urgencies(0, 3), [Some(u8::MAX); 3]);
}

#[test]
fn urgency_rises_as_satiety_decays() {
    let rounds = u64::from(2 * PECKISH / DECAY);
    let series = urgencies(2 * PECKISH, rounds);
    assert_eq!(series.len(), usize::try_from(rounds).expect("fits usize"));
    assert!(series.windows(2).all(|pair| pair[0] <= pair[1]));
    assert_eq!(series.last(), Some(&Some(u8::MAX)));
}

#[test]
fn satiety_survives_a_save() {
    let uninterrupted = urgencies(PECKISH, 4);
    let game = watched();
    let world = hungry(&game, PECKISH);
    let mut world = game.load(&game.save(&world)).expect("own save loads");
    run(&game, &mut world, 2);
    let mut world = game.load(&game.save(&world)).expect("own save loads");
    run(&game, &mut world, 2);
    assert_eq!(recorded(&game), uninterrupted);
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

fn grazing<R: Recipe>(first: R, flora: bool) -> Game<Both<R::Mechanics, Modules>> {
    let registry = Registry {
        wander: false,
        flora,
        ..Registry::default()
    };
    game(Then(first, registry), Seed(1))
}

fn glutton(flora: bool) -> Game<Both<Glutton, Modules>> {
    grazing(keyed(Glutton::build), flora)
}

/// A 9x9 floor holding `plants` and one actor at each of `actors`, every
/// actor at `satiety`.
fn meadow<M: Mechanics>(
    game: &Game<M>,
    satiety: u16,
    actors: &[Pos],
    plants: &[(Pos, u8)],
) -> (World, Vec<Handle>) {
    let ruleset = game.ruleset();
    let mut f = floor(ruleset, MEADOW, 9, 9);
    for &(at, growth) in plants {
        f.set_cell(ruleset, "plants", at, growth);
    }
    let handles = actors
        .iter()
        .map(|&at| {
            let h = f.spawn_actor(ruleset, at);
            f.init(ruleset, h, "hunger.satiety", Satiety(satiety));
            f.init(ruleset, h, Appetite::NAME, HERBIVORE);
            h
        })
        .collect();
    (World::new(vec![f]), handles)
}

fn plant<M: Mechanics>(game: &Game<M>, world: &World, at: Pos) -> u8 {
    world.floor(MEADOW).cell(game.ruleset(), "plants", at)
}

fn glutted(game: &Game<Both<Glutton, Modules>>) -> Vec<Option<u8>> {
    std::mem::take(
        &mut *game
            .mechanics()
            .0
            .seen
            .lock()
            .expect("no propose panicked while holding the lock"),
    )
}

#[test]
fn a_hungry_creature_walks_to_a_plant_and_grazes_it() {
    let game = glutton(true);
    let food = Pos { x: 6, y: 4 };
    let (mut world, actors) = meadow(&game, 0, &[Pos { x: 4, y: 4 }], &[(food, 8)]);
    run(&game, &mut world, 1);
    assert_eq!(world.floor(MEADOW).pos(actors[0]), Some(Pos { x: 5, y: 4 }));
    assert_ne!(plant(&game, &world, food), 0);
    run(&game, &mut world, 1);
    assert_eq!(plant(&game, &world, food), 0);
    run(&game, &mut world, 1);
    // One ripe plant sates an empty stomach.
    assert_eq!(glutted(&game), [Some(u8::MAX), Some(u8::MAX), Some(0)]);
}

#[test]
fn a_creature_approaches_a_plant_on_a_diagonal() {
    let game = glutton(true);
    let (mut world, actors) = meadow(&game, 0, &[Pos { x: 6, y: 6 }], &[(Pos { x: 4, y: 4 }, 3)]);
    run(&game, &mut world, 1);
    assert_eq!(world.floor(MEADOW).pos(actors[0]), Some(Pos { x: 5, y: 5 }));
}

#[test]
fn a_wall_stops_the_approach() {
    let game = glutton(true);
    let ruleset = game.ruleset();
    let (home, food) = (Pos { x: 4, y: 4 }, Pos { x: 6, y: 4 });
    let mut f = floor(ruleset, MEADOW, 9, 9);
    f.set_cell(ruleset, "plants", food, 3);
    f.set_material(Pos { x: 5, y: 4 }, Material::WALL);
    let h = f.spawn_actor(ruleset, home);
    f.init(ruleset, h, "hunger.satiety", Satiety(0));
    f.init(ruleset, h, Appetite::NAME, HERBIVORE);
    let mut world = World::new(vec![f]);
    run(&game, &mut world, 3);
    assert_eq!(world.floor(MEADOW).pos(h), Some(home));
    assert_ne!(plant(&game, &world, food), 0);
}

#[test]
fn the_nearer_plant_is_eaten_first() {
    let game = glutton(true);
    let (near, far) = (Pos { x: 5, y: 4 }, Pos { x: 7, y: 4 });
    let (mut world, _) = meadow(&game, 0, &[Pos { x: 4, y: 4 }], &[(near, 3), (far, 8)]);
    run(&game, &mut world, 1);
    assert_eq!(plant(&game, &world, near), 0);
    assert_ne!(plant(&game, &world, far), 0);
}

#[test]
fn of_two_plants_as_near_the_riper_is_eaten_first() {
    let game = glutton(true);
    let (young, riper) = (Pos { x: 4, y: 2 }, Pos { x: 4, y: 6 });
    let (mut world, _) = meadow(&game, 0, &[Pos { x: 4, y: 4 }], &[(young, 2), (riper, 5)]);
    run(&game, &mut world, 2);
    assert_eq!(plant(&game, &world, riper), 0);
    assert_ne!(plant(&game, &world, young), 0);
}

#[test]
fn one_plant_feeds_one_of_two_creatures() {
    let game = glutton(true);
    let food = Pos { x: 4, y: 4 };
    let (mut world, _) = meadow(
        &game,
        0,
        &[Pos { x: 3, y: 4 }, Pos { x: 5, y: 4 }],
        &[(food, 7)],
    );
    run(&game, &mut world, 1);
    assert_eq!(plant(&game, &world, food), 0);
    glutted(&game);
    run(&game, &mut world, 1);
    let fed = glutted(&game)
        .iter()
        .filter(|&&urgency| urgency < Some(u8::MAX))
        .count();
    assert_eq!(fed, 1);
}

#[test]
fn without_flora_a_hungry_creature_stays_put() {
    let game = glutton(false);
    let home = Pos { x: 4, y: 4 };
    let (mut world, actors) = meadow(&game, 0, &[home], &[]);
    run(&game, &mut world, 10);
    assert_eq!(world.floor(MEADOW).pos(actors[0]), Some(home));
    assert_eq!(world.floor(MEADOW).round(), Round(10));
}

#[test]
fn a_creature_without_appetite_never_grazes() {
    let game = game(
        Registry {
            wander: false,
            ..Registry::default()
        },
        Seed(1),
    );
    let ruleset = game.ruleset();
    let food = Pos { x: 5, y: 4 };
    let mut f = floor(ruleset, MEADOW, 9, 9);
    f.set_cell(ruleset, "plants", food, 3);
    let h = f.spawn_actor(ruleset, Pos { x: 4, y: 4 });
    f.init(ruleset, h, "hunger.satiety", Satiety(0));
    let mut world = World::new(vec![f]);
    run(&game, &mut world, 2);
    assert_ne!(plant(&game, &world, food), 0);
}

/// Outweighs any hunger in the routine band, and stays put against the
/// wall north of a creature on the top row.
fn rival() -> Scripted {
    Scripted(vec![Act {
        action: Fake::X,
        band: Band::Routine,
        weight: u16::MAX,
        target: Target::None,
        answer: Answer::Go(Dir::North),
    }])
}

/// Whether a creature at `satiety` before the round's decay grazes the
/// plant beside it over a heavier routine.
fn grazes_over_a_routine(satiety: u16) -> bool {
    let game = grazing(rival(), true);
    let food = Pos { x: 5, y: 1 };
    let (mut world, _) = meadow(&game, satiety, &[Pos { x: 4, y: 1 }], &[(food, 3)]);
    run(&game, &mut world, 1);
    plant(&game, &world, food) == 0
}

#[test]
fn a_starving_creature_grazes_before_any_routine() {
    assert!(grazes_over_a_routine(0));
}

#[test]
fn a_creature_at_the_starving_line_keeps_to_its_routine() {
    assert!(!grazes_over_a_routine(STARVING + DECAY));
}
