use korr_core::{
    host::{
        Cause, Event, Floor, Game, Mechanics, ModuleKey, ROT_PER_ROUND, Remains, Round, Ruleset,
        Seed, Then, Vitality, World, keyed,
    },
    mechanic::Pos,
};
use korr_ecs::{EntityId, FloorId, Handle};
use korr_hunger::config::STARVE_DAMAGE;
use korr_hunger::{Diet, Hunger};
use korr_scenarios::{GROUND, Pace, floor, game, nth, run, stomach};

const UPPER: FloorId = FloorId(1);
const HUNGER: Cause = Cause::Mechanic(ModuleKey::of("hunger"));
const MAX: u16 = 10;

mod actions;
mod causes;

fn mortal(f: &mut Floor, ruleset: &Ruleset, at: Pos, hp: u16, max: u16) -> Handle {
    let h = f.spawn_actor(ruleset, at);
    f.init(ruleset.vitality(), h, Vitality { hp, max });
    h
}

fn hunger_only() -> Game<Hunger> {
    game(keyed(Hunger::build), Seed(1))
}

/// One empty stomach on a 5x5 floor, with `hp` and `MAX`.
fn starving<M: Mechanics>(game: &Game<M>, hunger: &Hunger, hp: u16) -> (World, Handle) {
    let ruleset = game.ruleset();
    let mut f = floor(ruleset, GROUND, 5, 5);
    let h = mortal(&mut f, ruleset, Pos { x: 2, y: 2 }, hp, MAX);
    stomach(&mut f, hunger, h, 0, Diet::PLANTS);
    (World::new(vec![f]), h)
}

/// The id of the remains a starving creature leaves in round 2.
fn starved(game: &Game<Hunger>, world: &mut World) -> EntityId {
    run(game, world, 2);
    match world.floor(GROUND).events() {
        [Event::Died { .. }, Event::Spawned { id, .. }] => *id,
        other => panic!("one death and its remains, not {other:?}"),
    }
}

#[test]
fn a_starving_creature_dies_and_leaves_remains() {
    let game = hunger_only();
    let (mut world, h) = starving(&game, game.mechanics(), 2 * STARVE_DAMAGE);
    run(&game, &mut world, 1);
    assert!(world.floor(GROUND).pos(h).is_some());
    assert_eq!(world.floor(GROUND).events(), []);
    run(&game, &mut world, 1);
    let f = world.floor(GROUND);
    assert_eq!(f.pos(h), None);
    let dead = nth(GROUND, 0);
    let [
        Event::Died { id, cause },
        Event::Spawned {
            id: remains,
            cause: spawned,
        },
    ] = *f.events()
    else {
        panic!("one death and its remains, not {:?}", f.events());
    };
    assert_eq!((id, cause, spawned), (dead, HUNGER, HUNGER));
    assert_eq!(
        f.remains(game.ruleset(), remains),
        Some(&Remains {
            of: dead,
            mass: MAX
        })
    );
}

#[test]
fn remains_rot_away() {
    let game = hunger_only();
    let (mut world, _) = starving(&game, game.mechanics(), 2 * STARVE_DAMAGE);
    let remains = starved(&game, &mut world);
    let rounds = u64::from(MAX.div_ceil(ROT_PER_ROUND));
    run(&game, &mut world, rounds - 1);
    assert!(
        world
            .floor(GROUND)
            .remains(game.ruleset(), remains)
            .is_some()
    );
    run(&game, &mut world, 1);
    assert_eq!(world.floor(GROUND).remains(game.ruleset(), remains), None);
}

#[test]
fn starvation_in_the_bulk_phase_before_the_due_pops_does_not_panic() {
    let game = game(Then(Pace, keyed(Hunger::build)), Seed(1));
    let (mut world, h) = starving(&game, &game.mechanics().1, STARVE_DAMAGE);
    run(&game, &mut world, 1);
    assert_eq!(world.floor(GROUND).pos(h), None);
    assert!(matches!(
        world.floor(GROUND).events(),
        [Event::Died { cause: HUNGER, .. }, ..]
    ));
    run(&game, &mut world, 2);
    assert_eq!(world.floor(GROUND).round(), Round(3));
    assert_eq!(
        world.floor(GROUND).events(),
        [],
        "a round reports only its own events"
    );
}

/// Six creatures that starve one by one, every third round from round 3,
/// each leaving remains that outlast a few rounds.
fn famine(game: &Game<impl Mechanics>, hunger: &Hunger) -> World {
    let ruleset = game.ruleset();
    let mut f = floor(ruleset, GROUND, 9, 9);
    for k in 1..=6 {
        let y = i16::try_from(k).expect("a row fits i16");
        let h = mortal(&mut f, ruleset, Pos { x: 1, y }, 3 * k * STARVE_DAMAGE, 5);
        stomach(&mut f, hunger, h, 0, Diet::PLANTS);
    }
    World::new(vec![f])
}

#[test]
fn a_save_mid_famine_replays_the_uninterrupted_run() {
    let game = game(Then(Pace, keyed(Hunger::build)), Seed(1));
    let mut unbroken = famine(&game, &game.mechanics().1);
    run(&game, &mut unbroken, 20);
    let mut resumed = famine(&game, &game.mechanics().1);
    run(&game, &mut resumed, 10);
    let mut resumed = game.load(&game.save(&resumed)).expect("own save loads");
    run(&game, &mut resumed, 10);
    assert_eq!(game.hash(&resumed), game.hash(&unbroken));
}
