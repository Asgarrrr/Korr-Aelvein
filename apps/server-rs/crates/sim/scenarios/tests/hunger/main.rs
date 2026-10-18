use korr_core::{
    host::{Both, Floor, Game, Seed, Then, World},
    mechanic::Pos,
};
use korr_ecs::{FloorId, Handle};
use korr_engine::{Modules, Registry};
use korr_hunger::Diet;
use korr_scenarios::{Act, Scripted, floor, game, hunger, plants, stomach};

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

/// Gives `h` a stomach at `satiety` and a herbivore's diet.
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

mod diet;
mod disabled;
mod grazing;
mod save;
mod scoring;
