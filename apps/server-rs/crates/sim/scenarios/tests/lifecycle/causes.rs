use korr_core::{
    host::{Both, Cause, Event, Mechanics, ModuleKey, Recipe, Seed, Then, World, keyed},
    mechanic::Pos,
};
use korr_scenarios::{Bleeds, Clot, GROUND, Wound, bleed, floor, game, nth, run};

use super::{MAX, mortal};

bleed!(Bleed, "bleed", 3);
bleed!(Ooze, "ooze", 4);

/// The cause of the one death after a round where both bleeds harm an
/// actor that neither alone kills.
fn bled<A: Bleeds, B: Bleeds>(recipe: impl Recipe<Mechanics = Both<A, B>>) -> Cause
where
    Both<A, B>: Mechanics + Sync,
{
    let game = game(recipe, Seed(1));
    let ruleset = game.ruleset();
    let mut f = floor(ruleset, GROUND, 5, 5);
    let h = mortal(&mut f, ruleset, Pos { x: 2, y: 2 }, 7, 0);
    let Both(a, b) = game.mechanics();
    for (wound, clot) in [a.keys(), b.keys()] {
        f.insert(wound, h, Wound);
        f.insert(clot, h, Clot);
    }
    let mut world = World::new(vec![f]);
    run(&game, &mut world, 1);
    match *world.floor(GROUND).events() {
        [Event::Died { cause, .. }] => cause,
        ref other => panic!("one death, not {other:?}"),
    }
}

#[test]
fn the_lowest_cause_kills_whatever_the_registry_order() {
    let first = bled(Then(keyed(Bleed::build), keyed(Ooze::build)));
    let second = bled(Then(keyed(Ooze::build), keyed(Bleed::build)));
    assert_eq!(first, second);
    let lowest =
        Cause::Mechanic(ModuleKey::of("bleed")).min(Cause::Mechanic(ModuleKey::of("ooze")));
    assert_eq!(first, lowest);
}

/// The events of a round where `low` bleeds the higher id and `high` the
/// lower one, both to death.
fn bled_both<A: Bleeds, B: Bleeds>(
    recipe: impl Recipe<Mechanics = Both<A, B>>,
    low: &str,
    high: &str,
) -> Vec<Event>
where
    Both<A, B>: Mechanics + Sync,
{
    let game = game(recipe, Seed(1));
    let ruleset = game.ruleset();
    let mut f = floor(ruleset, GROUND, 5, 5);
    let first = mortal(&mut f, ruleset, Pos { x: 1, y: 2 }, 3, MAX);
    let second = mortal(&mut f, ruleset, Pos { x: 3, y: 2 }, 3, MAX);
    let Both(a, b) = game.mechanics();
    for (h, module) in [(first, high), (second, low)] {
        let (wound, clot) = if A::NAME == module {
            a.keys()
        } else {
            b.keys()
        };
        f.insert(wound, h, Wound);
        f.insert(clot, h, Clot);
    }
    let mut world = World::new(vec![f]);
    run(&game, &mut world, 1);
    let f = world.floor(GROUND);
    for event in f.events() {
        if let Event::Spawned { id, .. } = *event {
            assert!(f.remains(game.ruleset(), id).is_some());
        }
    }
    f.events().to_vec()
}

#[test]
fn deaths_in_one_drain_report_in_id_order_and_lay_remains_in_cause_order() {
    let bleed = Cause::Mechanic(ModuleKey::of("bleed"));
    let ooze = Cause::Mechanic(ModuleKey::of("ooze"));
    let ((low, low_cause), (high, high_cause)) = if bleed < ooze {
        (("bleed", bleed), ("ooze", ooze))
    } else {
        (("ooze", ooze), ("bleed", bleed))
    };
    let expected = [
        Event::Died {
            id: nth(GROUND, 0),
            cause: high_cause,
        },
        Event::Died {
            id: nth(GROUND, 1),
            cause: low_cause,
        },
        Event::Spawned {
            id: nth(GROUND, 2),
            cause: low_cause,
        },
        Event::Spawned {
            id: nth(GROUND, 3),
            cause: high_cause,
        },
    ];
    assert_eq!(
        bled_both(Then(keyed(Bleed::build), keyed(Ooze::build)), low, high),
        expected
    );
    assert_eq!(
        bled_both(Then(keyed(Ooze::build), keyed(Bleed::build)), low, high),
        expected
    );
}
