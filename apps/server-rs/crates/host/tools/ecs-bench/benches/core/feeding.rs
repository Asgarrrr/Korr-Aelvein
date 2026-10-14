use criterion::{BatchSize, BenchmarkId, Throughput};
use korr_core::host::{Event, Floor, Game, ROT_PER_ROUND, Remains, Seed, Vitality, World};
use korr_ecs::{EntityId, FloorId};
use korr_engine::{Modules, Registry};
use korr_hunger::config::STARVING;
use korr_hunger::{Diet, Satiety};
use korr_scenarios::{floor, game, hunger, plants, stomach};

use crate::{Group, Layout, REFERENCE, spread};

/// The mass of each remains of the feeding round: more than a round eats.
const CARRION: u16 = 100;
/// `REFERENCE` with every actor starving, even ones on plants and odd ones on
/// remains. Every other thing is remains, and a quarter of the interior is ripe.
fn feeding_floor(game: &Game<Modules>) -> Floor {
    let ruleset = game.ruleset();
    let hunger = game
        .mechanics()
        .hunger
        .as_ref()
        .expect("the registry runs hunger");
    let Layout {
        side,
        actors,
        things,
    } = REFERENCE;
    let mut f = floor(ruleset, FloorId(0), side, side);
    let inside = u32::from(side - 2);
    let (cells, plants) = (plants(game.mechanics()), inside * inside / 4);
    for k in 0..plants {
        f.set_cell(ruleset, cells, spread(side, k, plants), u8::MAX);
    }
    for k in 0..actors {
        let h = f.spawn_actor(ruleset, spread(side, k, actors));
        f.init(hunger.satiety(), h, Satiety(STARVING / 2));
        let diet = if k % 2 == 0 {
            Diet::PLANTS
        } else {
            Diet::REMAINS
        };
        f.init(hunger.diet(), h, diet);
    }
    for k in 0..things {
        let h = f.spawn_thing(spread(side, k, things));
        if k % 2 == 1 {
            let of = EntityId::new(FloorId(0), 0);
            f.init(ruleset.remains(), h, Remains { of, mass: CARRION });
        }
    }
    f
}

/// Whether one round grazed a plant and fed on remains.
fn feeds_both_diets(game: &Game<Modules>, world: &World) -> bool {
    let (ruleset, f) = (game.ruleset(), world.floor(FloorId(0)));
    let Layout {
        side,
        actors,
        things,
    } = REFERENCE;
    let inside = u32::from(side - 2);
    let (cells, plants) = (plants(game.mechanics()), inside * inside / 4);
    let grazed = (0..plants).any(|k| f.cell(ruleset, cells, spread(side, k, plants)) == 0);
    let fed_on = (1..things).step_by(2).any(|k| {
        let id = EntityId::new(FloorId(0), u64::from(actors + k));
        f.remains(ruleset, id)
            .is_some_and(|r| r.mass < CARRION - ROT_PER_ROUND)
    });
    grazed && fed_on
}

pub(crate) fn feeding(group: &mut Group<'_>) {
    let game = game(Registry::default(), Seed(1));
    let bytes = game.save(&World::new(vec![feeding_floor(&game)]));
    let mut fed = game.load(&bytes).expect("own save loads");
    game.run_round(&mut fed);
    // Reloaded every round: a kept world drifts to sated eaters.
    assert!(feeds_both_diets(&game, &fed), "one round feeds both diets");
    group.throughput(Throughput::Elements(REFERENCE.entities()));
    group.bench_function(BenchmarkId::from_parameter("feeding"), |b| {
        b.iter_batched(
            || game.load(&bytes).expect("own save loads"),
            |mut world| {
                game.run_round(&mut world);
                world
            },
            BatchSize::LargeInput,
        );
    });
}

/// `REFERENCE` with every actor on an empty stomach and nothing to eat: each
/// round harms every actor, and kills it in `hp` rounds.
fn starving_floor(game: &Game<Modules>, hp: u16) -> Floor {
    let (ruleset, hunger) = (game.ruleset(), hunger(game.mechanics()));
    let Layout {
        side,
        actors,
        things,
    } = REFERENCE;
    let mut f = floor(ruleset, FloorId(0), side, side);
    for k in 0..actors {
        let h = f.spawn_actor(ruleset, spread(side, k, actors));
        stomach(&mut f, hunger, h, 0, Diet::PLANTS);
        f.init(ruleset.vitality(), h, Vitality { hp, max: hp });
    }
    for k in 0..things {
        f.spawn_thing(spread(side, k, things));
    }
    f
}

pub(crate) fn starving(group: &mut Group<'_>) {
    let game = game(Registry::default(), Seed(1));
    let mut doomed = World::new(vec![starving_floor(&game, 1)]);
    game.run_round(&mut doomed);
    let died = doomed
        .floor(FloorId(0))
        .events()
        .iter()
        .filter(|event| matches!(event, Event::Died { .. }))
        .count();
    assert_eq!(
        u32::try_from(died).expect("a death count fits u32"),
        REFERENCE.actors,
        "one round harms every actor"
    );
    // No measurement lasts `u16::MAX` rounds: no one dies, so a kept world never drifts.
    let mut world = World::new(vec![starving_floor(&game, u16::MAX)]);
    group.throughput(Throughput::Elements(REFERENCE.entities()));
    group.bench_function(BenchmarkId::from_parameter("starving"), |b| {
        b.iter(|| game.run_round(&mut world));
    });
}
