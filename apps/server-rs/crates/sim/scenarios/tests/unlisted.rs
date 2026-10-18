use korr_core::{
    host::{Seed, World},
    mechanic::{
        Action, Band, CommitCtx, Cost, Module, Pos, PrepCtx, Prepared, Proposals, Senses, Target,
    },
};
use korr_ecs::FloorId;
use korr_scenarios::{floor, game, run};

/// `Unlisted` is left out of `ALL`; the flag picks how it reaches the core.
#[derive(Debug)]
struct Partial {
    redirect: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Listing {
    Listed,
    Unlisted,
}

impl Action for Listing {
    const ALL: &'static [Self] = &[Self::Listed];

    fn name(self) -> &'static str {
        match self {
            Self::Listed => "listed",
            Self::Unlisted => "unlisted",
        }
    }
}

impl Module for Partial {
    const NAME: &'static str = "partial";
    type Action = Listing;
    type Plan = ();

    fn propose(&self, _: &Senses<'_>, out: &mut Proposals<'_, Listing>) {
        let action = if self.redirect {
            Listing::Listed
        } else {
            Listing::Unlisted
        };
        out.push(action, Band::Routine, 1, Target::None);
    }

    fn prepare(&self, action: Listing, _: Target, _: &PrepCtx<'_>) -> Prepared<Listing, ()> {
        if action == Listing::Listed && self.redirect {
            return Prepared::Instead {
                action: Listing::Unlisted,
                target: Target::None,
            };
        }
        Prepared::Go {
            cost: Cost::new(100),
            plan: (),
        }
    }

    fn commit(&self, (): (), _: &mut CommitCtx<'_>) {}
}

fn one_turn(redirect: bool) {
    let game = game(Partial { redirect }, Seed(1));
    let mut f = floor(game.ruleset(), FloorId(0), 5, 5);
    f.spawn_actor(game.ruleset(), Pos { x: 2, y: 2 });
    run(&game, &mut World::new(vec![f]), 1);
}

#[test]
#[should_panic(expected = "action missing from its module's ALL: Unlisted")]
fn proposing_an_unlisted_action_panics() {
    one_turn(false);
}

#[test]
#[should_panic(expected = "action missing from its module's ALL: Unlisted")]
fn redirecting_to_an_unlisted_action_panics() {
    one_turn(true);
}
