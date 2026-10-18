use korr_core::{
    host::{Event, Floor, Game, Mechanics, ROT_PER_ROUND, Seed, Vitality, World},
    mechanic::Pos,
};
use korr_ecs::{EntityId, FloorId, Handle};
use korr_engine::{Modules, Registry};
use korr_hunger::Diet;
use korr_hunger::config::{BITE, STARVE_DAMAGE};
use korr_scenarios::{bleed, floor, game, hunger, run, stomach};

const FIELD: FloorId = FloorId(0);
const SEED: Seed = Seed(1);
/// Two bites and two rots leave one unit, so a third bite, not rot, empties it.
const MASS: u16 = 2 * (BITE + ROT_PER_ROUND) + 1;
/// Where the first donor dies and leaves its remains.
const CARCASS: Pos = Pos { x: 4, y: 4 };

fn carnivorous() -> Game<Modules> {
    game(
        Registry {
            wander: false,
            ..Registry::default()
        },
        SEED,
    )
}

fn eater(f: &mut Floor, game: &Game<Modules>, at: Pos, satiety: u16, diet: Diet) -> Handle {
    let h = f.spawn_actor(game.ruleset(), at);
    stomach(f, hunger(game.mechanics()), h, satiety, diet);
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
        f.set_cell(
            game.ruleset(),
            korr_scenarios::plants(game.mechanics()),
            at,
            growth,
        );
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

bleed!(Bleed, "bleed", 1);

mod disabled;
mod feeding;
mod reload;
mod sight;
