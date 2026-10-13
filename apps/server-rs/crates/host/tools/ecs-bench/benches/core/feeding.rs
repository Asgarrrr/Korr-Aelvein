use criterion::{BatchSize, BenchmarkId, Throughput};
use korr_core::host::{Floor, Game, ROT_PER_ROUND, Remains, Seed, World};
use korr_ecs::{EntityId, FloorId};
use korr_engine::{Modules, Registry};
use korr_hunger::config::STARVING;
use korr_hunger::{Diet, Satiety};
use korr_scenarios::{floor, game, plants};

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
