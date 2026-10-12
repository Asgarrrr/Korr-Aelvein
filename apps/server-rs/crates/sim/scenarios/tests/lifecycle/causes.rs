use core::convert::Infallible;

use korr_core::{
    host::{Cause, Event, ModuleKey, Recipe, Seed, Then, World, keyed},
    mechanic::{
        Builder, CommitCtx, Component, ImageError, Module, Own, Pos, PrepCtx, Prepared, Proposals,
        Reader, Rows, Senses, Target, Writer,
    },
};
use korr_scenarios::{floor, game, run};

use super::{GROUND, MAX, mortal, nth};

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

/// Declares `$module`, named `$name`: its tick harms every holder of its
/// wound and clot by `$amount`.
macro_rules! bleed {
    ($module:ident, $name:literal, $amount:literal) => {
        struct $module {
            wound: Own<Wound>,
            clot: Own<Clot>,
        }

        impl $module {
            fn build(b: &mut Builder<'_>) -> Self {
                Self {
                    wound: b.own("wound"),
                    clot: b.own("clot"),
                }
            }
        }

        impl Module for $module {
            const NAME: &'static str = $name;
            type Action = Infallible;
            type Plan = Infallible;

            fn tick_rows(&self, rows: &mut Rows<'_>) {
                rows.join(&self.wound, &self.clot, |_, _| $amount);
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
    };
}

bleed!(Bleed, "bleed", 3);
bleed!(Ooze, "ooze", 4);

/// The cause of the one death after a round where both bleeds harm an
/// actor that neither alone kills.
fn bled<R: Recipe<Mechanics: Sync>>(recipe: R) -> Cause {
    let game = game(recipe, Seed(1));
    let ruleset = game.ruleset();
    let mut f = floor(ruleset, GROUND, 5, 5);
    let h = mortal(&mut f, ruleset, Pos { x: 2, y: 2 }, 7, 0);
    for module in ["bleed", "ooze"] {
        f.init(ruleset, h, &format!("{module}.wound"), Wound);
        f.init(ruleset, h, &format!("{module}.clot"), Clot);
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
fn bled_both<R: Recipe<Mechanics: Sync>>(recipe: R, low: &str, high: &str) -> Vec<Event> {
    let game = game(recipe, Seed(1));
    let ruleset = game.ruleset();
    let mut f = floor(ruleset, GROUND, 5, 5);
    let first = mortal(&mut f, ruleset, Pos { x: 1, y: 2 }, 3, MAX);
    let second = mortal(&mut f, ruleset, Pos { x: 3, y: 2 }, 3, MAX);
    for (h, module) in [(first, high), (second, low)] {
        f.init(ruleset, h, &format!("{module}.wound"), Wound);
        f.init(ruleset, h, &format!("{module}.clot"), Clot);
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
