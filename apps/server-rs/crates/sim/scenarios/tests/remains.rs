use core::convert::Infallible;

use korr_core::{
    host::{
        Event, Floor, Game, Mechanics, ROT_PER_ROUND, Round, Seed, Then, Vitality, World, keyed,
    },
    mechanic::{
        Builder, CommitCtx, Component, ImageError, Module, Own, Pos, PrepCtx, Prepared, Proposals,
        Reader, Rows, Senses, Target, Writer,
    },
};
use korr_ecs::{EntityId, FloorId, Handle};
use korr_engine::{Modules, Registry};
use korr_hunger::config::{BITE, DECAY, PECKISH, REMAINS_NUTRITION, STARVE_DAMAGE};
use korr_hunger::{Diet, Satiety};
use korr_scenarios::{floor, game, reload, run};

const FIELD: FloorId = FloorId(0);
const SEED: Seed = Seed(1);
/// Two bites and two rots leave one unit, so a third bite, not rot, empties it.
const MASS: u16 = 2 * (BITE + ROT_PER_ROUND) + 1;
/// Where the first donor dies and leaves its remains.
const CARCASS: Pos = Pos { x: 4, y: 4 };

fn carnivorous(flora: bool) -> Game<Modules> {
    game(
        Registry {
            wander: false,
            flora,
            ..Registry::default()
        },
        SEED,
    )
}

fn eater(f: &mut Floor, game: &Game<Modules>, at: Pos, satiety: u16, diet: Diet) -> Handle {
    let hunger = game
        .mechanics()
        .hunger
        .as_ref()
        .expect("the registry runs hunger");
    let h = f.spawn_actor(game.ruleset(), at);
    f.init(hunger.satiety(), h, Satiety(satiety));
    f.init(hunger.diet(), h, diet);
    h
}

/// A 9x9 floor where each donor starves in round 1, leaving remains of its
/// mass, then one creature at each eater's position, satiety and diet.
fn field(
    game: &Game<Modules>,
    donors: &[(Pos, u16)],
    eaters: &[(Pos, u16, Diet)],
) -> (World, Vec<Handle>) {
    fed_field(game, donors, eaters, &[])
}

/// A `field` with plants of the given growth.
fn fed_field(
    game: &Game<Modules>,
    donors: &[(Pos, u16)],
    eaters: &[(Pos, u16, Diet)],
    plants: &[(Pos, u8)],
) -> (World, Vec<Handle>) {
    let mut f = floor(game.ruleset(), FIELD, 9, 9);
    for &(at, growth) in plants {
        f.set_cell(game.ruleset(), "plants", at, growth);
    }
    for &(at, mass) in donors {
        let h = eater(&mut f, game, at, 0, Diet::PLANTS);
        let vitality = Vitality {
            hp: STARVE_DAMAGE,
            max: mass,
        };
        f.init(game.ruleset().vitality(), h, vitality);
    }
    let eaters = eaters
        .iter()
        .map(|&(at, satiety, diet)| eater(&mut f, game, at, satiety, diet))
        .collect();
    (World::new(vec![f]), eaters)
}

/// The remains laid this round, in spawn order.
fn laid(world: &World) -> Vec<EntityId> {
    world
        .floor(FIELD)
        .events()
        .iter()
        .filter_map(|event| match *event {
            Event::Spawned { id, .. } => Some(id),
            Event::Died { .. } => None,
        })
        .collect()
}

fn mass(game: &Game<impl Mechanics>, world: &World, id: EntityId) -> Option<u16> {
    world
        .floor(FIELD)
        .remains(game.ruleset(), id)
        .map(|remains| remains.mass)
}

/// The mass of the one remains after each of `rounds`, eaten by a starving
/// creature of `diet` beside it.
fn masses(game: &Game<Modules>, diet: Diet, rounds: usize) -> Vec<Option<u16>> {
    let (mut world, _) = field(game, &[(CARCASS, MASS)], &[(Pos { x: 5, y: 4 }, 0, diet)]);
    run(game, &mut world, 1);
    let [remains] = laid(&world)[..] else {
        panic!("one donor, one remains");
    };
    let mut masses = vec![mass(game, &world, remains)];
    for _ in 1..rounds {
        run(game, &mut world, 1);
        masses.push(mass(game, &world, remains));
    }
    masses
}

#[test]
fn a_carnivore_eats_remains_away() {
    assert_eq!(
        masses(&carnivorous(true), Diet::REMAINS, 3),
        [
            Some(MASS - BITE),
            Some(MASS - 2 * BITE - ROT_PER_ROUND),
            None
        ]
    );
}

#[test]
fn a_herbivore_never_feeds_on_remains() {
    assert_eq!(
        masses(&carnivorous(true), Diet::PLANTS, 3),
        [
            Some(MASS),
            Some(MASS - ROT_PER_ROUND),
            Some(MASS - 2 * ROT_PER_ROUND)
        ]
    );
}

#[test]
fn without_flora_a_carnivore_still_feeds() {
    assert_eq!(
        masses(&carnivorous(false), Diet::REMAINS, 1),
        [Some(MASS - BITE)]
    );
}

/// The remains' mass and the plant's growth after round 1, when a starving
/// creature of `diet` lies between the remains and a plant of
/// `growth`, which grows one step before it acts.
fn first_meal(diet: Diet, growth: u8) -> (Option<u16>, u8) {
    let game = carnivorous(true);
    let plant = Pos { x: 6, y: 4 };
    let mut world = fed_field(
        &game,
        &[(CARCASS, MASS)],
        &[(Pos { x: 5, y: 4 }, 0, diet)],
        &[(plant, growth)],
    )
    .0;
    run(&game, &mut world, 1);
    let [remains] = laid(&world)[..] else {
        panic!("one donor, one remains");
    };
    let growth = world.floor(FIELD).cell(game.ruleset(), "plants", plant);
    (mass(&game, &world, remains), growth)
}

fn omnivore() -> Diet {
    Diet::PLANTS | Diet::REMAINS
}

#[test]
fn of_foods_as_near_and_as_nourishing_the_first_in_row_order_is_eaten() {
    assert_eq!(first_meal(omnivore(), 1), (Some(MASS - BITE), 2));
}

#[test]
fn a_plant_more_nourishing_than_a_bite_is_eaten_first() {
    assert_eq!(first_meal(omnivore(), 2), (Some(MASS), 0));
}

#[test]
fn a_carnivore_never_grazes() {
    assert_eq!(first_meal(Diet::REMAINS, 2), (Some(MASS - BITE), 3));
}

#[test]
fn one_bite_that_sates_ends_the_meal() {
    let game = carnivorous(true);
    // One bite lifts it to `PECKISH` after the next decay.
    let satiety = PECKISH + 2 * DECAY - BITE * REMAINS_NUTRITION;
    let eater = (Pos { x: 5, y: 4 }, satiety, Diet::REMAINS);
    let (mut world, _) = field(&game, &[(CARCASS, MASS)], &[eater]);
    run(&game, &mut world, 1);
    let [remains] = laid(&world)[..] else {
        panic!("one donor, one remains");
    };
    run(&game, &mut world, 1);
    assert_eq!(
        mass(&game, &world, remains),
        Some(MASS - BITE - ROT_PER_ROUND)
    );
}

/// The last unit of one remains lies between two carnivores, each of which
/// it sates; other remains lie 3 cells from both.
#[test]
fn of_two_carnivores_one_eats_the_last_unit() {
    let game = carnivorous(true);
    let satiety = PECKISH + 2 * DECAY - REMAINS_NUTRITION;
    let sides = [Pos { x: 3, y: 4 }, Pos { x: 5, y: 4 }];
    let (mut world, carnivores) = field(
        &game,
        &[(CARCASS, 1), (Pos { x: 4, y: 1 }, MASS)],
        &sides.map(|at| (at, satiety, Diet::REMAINS)),
    );
    run(&game, &mut world, 1);
    let [last, far] = laid(&world)[..] else {
        panic!("two donors, two remains");
    };
    assert_eq!(mass(&game, &world, last), None);
    assert_eq!(mass(&game, &world, far), Some(MASS));
    run(&game, &mut world, 1);
    let hungry = carnivores
        .iter()
        .zip(sides)
        .filter(|&(&h, at)| world.floor(FIELD).pos(h) != Some(at))
        .count();
    assert_eq!(hungry, 1, "only the carnivore that did not eat walks on");
}

/// The hash after 4 rounds of a carnivore 3 cells from remains, and
/// whether the remains are gone by then.
fn approached(reloaded: bool) -> (u64, bool) {
    let game = carnivorous(true);
    let eater = (Pos { x: 7, y: 4 }, 0, Diet::REMAINS);
    let (mut world, _) = field(&game, &[(CARCASS, MASS)], &[eater]);
    run(&game, &mut world, 1);
    let [remains] = laid(&world)[..] else {
        panic!("one donor, one remains");
    };
    for _ in 0..4 {
        if reloaded {
            world = World::new(vec![reload(game.ruleset(), world.floor(FIELD))]);
        }
        run(&game, &mut world, 1);
    }
    (game.hash(&world), mass(&game, &world, remains).is_none())
}

#[test]
fn a_reload_every_round_keeps_the_approach_to_remains() {
    let unbroken = approached(false);
    assert!(unbroken.1, "the carnivore reaches and eats the remains");
    assert_eq!(approached(true), unbroken);
}

struct Wound;

impl Component for Wound {
    const VERSION: u16 = 0;

    fn write(&self, _: &mut Writer) {}

    fn read(_: &mut Reader<'_>) -> Result<Self, ImageError> {
        Ok(Self)
    }
}

struct Clot;

impl Component for Clot {
    const VERSION: u16 = 0;

    fn write(&self, _: &mut Writer) {}

    fn read(_: &mut Reader<'_>) -> Result<Self, ImageError> {
        Ok(Self)
    }
}

/// Its tick harms every holder of its wound and clot by 1.
struct Bleed {
    wound: Own<Wound>,
    clot: Own<Clot>,
}

impl Bleed {
    fn build(b: &mut Builder<'_>) -> Self {
        Self {
            wound: b.own("wound"),
            clot: b.own("clot"),
        }
    }
}

impl Module for Bleed {
    const NAME: &'static str = "bleed";
    type Action = Infallible;
    type Plan = Infallible;

    fn tick_rows(&self, rows: &mut Rows<'_>) {
        rows.join(&self.wound, &self.clot, |_, _| 1);
    }

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
fn the_game_runs_with_remains_and_without_hunger() {
    let game = game(
        Then(
            keyed(Bleed::build),
            Registry {
                hunger: false,
                ..Registry::default()
            },
        ),
        SEED,
    );
    let ruleset = game.ruleset();
    let mut f = floor(ruleset, FIELD, 9, 9);
    let h = f.spawn_actor(ruleset, CARCASS);
    f.init(ruleset.vitality(), h, Vitality { hp: 1, max: MASS });
    let bleed = &game.mechanics().0;
    f.insert(&bleed.wound, h, Wound);
    f.insert(&bleed.clot, h, Clot);
    f.spawn_actor(ruleset, Pos { x: 5, y: 4 });
    let mut world = World::new(vec![f]);
    run(&game, &mut world, 1);
    let [remains] = laid(&world)[..] else {
        panic!("one death, one remains");
    };
    assert_eq!(mass(&game, &world, remains), Some(MASS));
    run(&game, &mut world, 29);
    assert_eq!(world.floor(FIELD).round(), Round(30));
}
