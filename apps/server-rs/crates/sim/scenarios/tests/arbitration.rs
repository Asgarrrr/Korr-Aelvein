use korr_core::{
    host::{ActionKey, Mechanics, Seed, Visit, World},
    mechanic::{
        Action, Band, CommitCtx, Dir, Module, Pos, PrepCtx, Prepared, Proposals, Senses, Target,
        Tick,
    },
};
use korr_ecs::FloorId;
use korr_scenarios::{Act, Answer, Fake, Pace, Scripted, floor, game};

const START: Pos = Pos { x: 4, y: 4 };

fn act(action: Fake, weight: u16, answer: Answer) -> Act {
    Act {
        action,
        band: Band::Routine,
        weight,
        target: Target::None,
        answer,
    }
}

fn run(acts: Vec<Act>, rounds: u64) -> Pos {
    let game = game(Scripted(acts), Seed(1));
    let mut f = floor(game.ruleset(), FloorId(0), 9, 9);
    let actor = f.spawn_actor(game.ruleset(), START);
    let mut world = World::new(vec![f]);
    korr_scenarios::run(&game, &mut world, rounds);
    world
        .floor(FloorId(0))
        .pos(actor)
        .expect("the actor stays placed")
}

fn after(dir: Dir) -> Pos {
    let (dx, dy) = dir.offset();
    Pos {
        x: START.x + dx,
        y: START.y + dy,
    }
}

#[test]
fn ties_break_on_action_key_whatever_the_registry_order() {
    let x = act(Fake::X, 10, Answer::Go(Dir::East));
    let y = act(Fake::Y, 10, Answer::Go(Dir::West));
    let forward = run(vec![x, y], 1);
    let backward = run(vec![y, x], 1);
    assert_eq!(forward, backward);
    let expected = if ActionKey::of::<Scripted>(Fake::X) < ActionKey::of::<Scripted>(Fake::Y) {
        Dir::East
    } else {
        Dir::West
    };
    assert_eq!(forward, after(expected));
}

#[test]
fn ties_on_one_action_break_on_target() {
    let north = Act {
        target: Target::Pos(Pos { x: 1, y: 1 }),
        ..act(Fake::X, 10, Answer::Go(Dir::North))
    };
    let south = Act {
        target: Target::Pos(Pos { x: 1, y: 2 }),
        ..act(Fake::X, 10, Answer::Go(Dir::South))
    };
    assert_eq!(run(vec![north, south], 1), after(Dir::North));
    assert_eq!(run(vec![south, north], 1), after(Dir::North));
}

#[test]
fn a_higher_band_beats_any_weight() {
    let routine = act(Fake::X, u16::MAX, Answer::Go(Dir::East));
    let vigilance = Act {
        band: Band::Vigilance,
        ..act(Fake::Y, 0, Answer::Go(Dir::West))
    };
    assert_eq!(run(vec![routine, vigilance], 1), after(Dir::West));
}

#[test]
fn an_instead_loop_fails_at_the_cap_then_falls_back() {
    let looping = act(Fake::X, 10, Answer::Instead(Fake::X));
    let fallback = act(Fake::Y, 1, Answer::Go(Dir::East));
    assert_eq!(run(vec![looping, fallback], 1), after(Dir::East));
}

#[test]
fn a_second_fail_idles() {
    let acts = vec![
        act(Fake::X, 10, Answer::Fail),
        act(Fake::Y, 5, Answer::Fail),
        act(Fake::Z, 1, Answer::Go(Dir::East)),
    ];
    assert_eq!(run(acts, 1), START);
}

#[test]
fn inertia_keeps_the_current_intent_on_a_tie() {
    let (low, high) = if ActionKey::of::<Scripted>(Fake::X) < ActionKey::of::<Scripted>(Fake::Y) {
        (Fake::X, Fake::Y)
    } else {
        (Fake::Y, Fake::X)
    };
    let acts = vec![
        act(low, 10, Answer::FailBefore(Tick(100), Dir::East)),
        act(high, 10, Answer::Go(Dir::West)),
    ];
    assert_eq!(run(acts, 2).x, 2);
}

/// A module whose two actions share one name, so one key.
#[derive(Debug)]
struct Twin;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum TwinAction {
    A,
    B,
}

impl Action for TwinAction {
    const ALL: &'static [Self] = &[Self::A, Self::B];

    fn name(self) -> &'static str {
        "same"
    }
}

impl Module for Twin {
    const NAME: &'static str = "twin";
    type Action = TwinAction;
    type Plan = ();

    fn propose(&self, _: &Senses<'_>, _: &mut Proposals<'_, TwinAction>) {}

    fn prepare(&self, _: TwinAction, _: Target, _: &PrepCtx<'_>) -> Prepared<TwinAction, ()> {
        Prepared::Fail
    }

    fn commit(&self, (): (), _: &mut CommitCtx<'_>) {}
}

#[test]
#[should_panic(expected = "action key collision")]
fn colliding_action_keys_panic_at_build() {
    let _ = game(Twin, Seed(1));
}

/// A second module under `Pace`'s name.
#[derive(Debug)]
struct Imposter;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Other {
    Other,
}

impl Action for Other {
    const ALL: &'static [Self] = &[Self::Other];

    fn name(self) -> &'static str {
        "other"
    }
}

impl Module for Imposter {
    const NAME: &'static str = "pace";
    type Action = Other;
    type Plan = ();

    fn propose(&self, _: &Senses<'_>, _: &mut Proposals<'_, Other>) {}

    fn prepare(&self, _: Other, _: Target, _: &PrepCtx<'_>) -> Prepared<Other, ()> {
        Prepared::Fail
    }

    fn commit(&self, (): (), _: &mut CommitCtx<'_>) {}
}

#[derive(Debug)]
struct PaceThenImposter;

impl Mechanics for PaceThenImposter {
    fn each<V: Visit>(&self, v: &mut V) {
        v.module(&Pace);
        v.module(&Imposter);
    }
}

#[test]
#[should_panic(expected = "module registered twice: pace")]
fn a_module_name_registered_twice_panics() {
    let _ = game(PaceThenImposter, Seed(1));
}
