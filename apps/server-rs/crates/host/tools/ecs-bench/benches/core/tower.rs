use criterion::{BatchSize, BenchmarkId, Criterion, Throughput};
use korr_core::host::{Pos, Recipe, SIGHT, Seed, World};
use korr_ecs::FloorId;
use korr_engine::Registry;
use korr_hunger::Diet;
use korr_hunger::config::STARVING;
use korr_scenarios::{Shy, floor, game, hunger, plants, stomach};

use crate::{Group, Layout, TOWER, build, spread};

/// The plant that `k`-th actor at `at` finds: at the edge of its sight for
/// an even `k`, so it walks, and next to it for an odd one, so it grazes.
fn plant_of(k: u32, at: Pos) -> Pos {
    let reach = if k.is_multiple_of(2) {
        SIGHT.cast_signed()
    } else {
        1
    };
    let last = TOWER.side.cast_signed() - 2;
    let x = if at.x + reach <= last {
        at.x + reach
    } else {
        at.x - reach
    };
    Pos { x, y: at.y }
}

/// Every round of `recipe` on the kept `TOWER`.
fn kept(group: &mut Group<'_>, id: &str, recipe: impl Recipe<Mechanics: Sync>) {
    let (mut world, game) = build(recipe, &[TOWER]);
    group.bench_function(BenchmarkId::from_parameter(id), |b| {
        b.iter(|| game.run_round(&mut world));
    });
}

/// `TOWER` with every actor starving and a plant in sight, reloaded every
/// round: a kept world drifts to sated eaters.
fn hunger_tower(group: &mut Group<'_>) {
    let game = game(Registry::default(), Seed(1));
    let (ruleset, hunger, cells) = (
        game.ruleset(),
        hunger(game.mechanics()),
        plants(game.mechanics()),
    );
    let Layout {
        side,
        actors,
        things,
    } = TOWER;
    let mut f = floor(ruleset, FloorId(0), side, side);
    let mut sown = Vec::new();
    for k in 0..actors {
        let start = spread(side, k, actors);
        let h = f.spawn_actor(ruleset, start);
        stomach(&mut f, hunger, h, STARVING / 2, Diet::PLANTS);
        let plant = plant_of(k, start);
        f.set_cell(ruleset, cells, plant, u8::MAX);
        sown.push((h, start, plant));
    }
    for k in 0..things {
        f.spawn_thing(spread(side, k, things));
    }
    let mut world = World::new(vec![f]);
    let bytes = game.save(&world);
    game.run_round(&mut world);
    let f = world.floor(FloorId(0));
    let grazed = sown
        .iter()
        .skip(1)
        .step_by(2)
        .any(|&(_, _, plant)| f.cell(ruleset, cells, plant) == 0);
    let walked = sown
        .iter()
        .step_by(2)
        .any(|&(h, start, _)| f.pos(h) != Some(start));
    // A round that neither grazes nor walks would time the idle path.
    assert!(grazed && walked, "one round grazes and approaches");
    group.bench_function(BenchmarkId::from_parameter("hunger_tower"), |b| {
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

pub(crate) fn actor_turn(c: &mut Criterion) {
    let mut group = c.benchmark_group("actor_turn");
    group.throughput(Throughput::Elements(u64::from(TOWER.actors)));
    kept(
        &mut group,
        "wander_tower",
        Registry {
            flora: false,
            hunger: false,
            ..Registry::default()
        },
    );
    kept(&mut group, "perceiving_tower", Shy);
    hunger_tower(&mut group);
    group.finish();
}
