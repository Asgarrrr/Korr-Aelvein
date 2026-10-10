use korr_core::{ActionDesc, Band, Dir, Pos, Ruleset, Seed, Target, Tick, World};
use korr_ecs::{FloorId, SchemaBuilder};
use korr_scenarios::{Act, Answer, Scripted, floor};

static X: ActionDesc = ActionDesc::new("fake", "x");
static Y: ActionDesc = ActionDesc::new("fake", "y");
static Z: ActionDesc = ActionDesc::new("fake", "z");
static SAME_A: ActionDesc = ActionDesc::new("fake", "same");
static SAME_B: ActionDesc = ActionDesc::new("fake", "same");

const START: Pos = Pos { x: 4, y: 4 };

fn act(desc: &'static ActionDesc, weight: u16, answer: Answer) -> Act {
    Act {
        desc,
        band: Band::Routine,
        weight,
        target: Target::None,
        answer,
    }
}

fn run(acts: Vec<Act>, rounds: u64) -> Pos {
    let script = Scripted(acts);
    let ruleset = Ruleset::new(SchemaBuilder::default(), &script);
    let mut f = floor(&ruleset, 0, 9, 9);
    let actor = f.spawn_actor(&ruleset, START);
    let mut world = World::new(Seed(1), vec![f]);
    for _ in 0..rounds {
        world.run_round(&ruleset, &script);
    }
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
    let x = act(&X, 10, Answer::Go(Dir::East));
    let y = act(&Y, 10, Answer::Go(Dir::West));
    let forward = run(vec![x, y], 1);
    let backward = run(vec![y, x], 1);
    assert_eq!(forward, backward);
    let expected = if X.key() < Y.key() {
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
        ..act(&X, 10, Answer::Go(Dir::North))
    };
    let south = Act {
        target: Target::Pos(Pos { x: 1, y: 2 }),
        ..act(&X, 10, Answer::Go(Dir::South))
    };
    assert_eq!(run(vec![north, south], 1), after(Dir::North));
    assert_eq!(run(vec![south, north], 1), after(Dir::North));
}

#[test]
fn a_higher_band_beats_any_weight() {
    let routine = act(&X, u16::MAX, Answer::Go(Dir::East));
    let vigilance = Act {
        band: Band::Vigilance,
        ..act(&Y, 0, Answer::Go(Dir::West))
    };
    assert_eq!(run(vec![routine, vigilance], 1), after(Dir::West));
}

#[test]
fn an_instead_loop_fails_at_the_cap_then_falls_back() {
    let looping = act(&X, 10, Answer::Instead(&X));
    let fallback = act(&Y, 1, Answer::Go(Dir::East));
    assert_eq!(run(vec![looping, fallback], 1), after(Dir::East));
}

#[test]
fn a_second_fail_idles() {
    let acts = vec![
        act(&X, 10, Answer::Fail),
        act(&Y, 5, Answer::Fail),
        act(&Z, 1, Answer::Go(Dir::East)),
    ];
    assert_eq!(run(acts, 1), START);
}

#[test]
fn inertia_keeps_the_current_intent_on_a_tie() {
    let (low, high) = if X.key() < Y.key() {
        (&X, &Y)
    } else {
        (&Y, &X)
    };
    let acts = vec![
        act(low, 10, Answer::FailBefore(Tick(100), Dir::East)),
        act(high, 10, Answer::Go(Dir::West)),
    ];
    assert_eq!(run(acts, 2).x, 2);
}

#[test]
#[should_panic(expected = "action key collision")]
fn colliding_action_keys_panic_at_build() {
    let acts = vec![act(&SAME_A, 1, Answer::Fail), act(&SAME_B, 1, Answer::Fail)];
    let _ = Ruleset::new(SchemaBuilder::default(), &Scripted(acts));
}
