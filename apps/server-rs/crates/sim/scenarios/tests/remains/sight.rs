use korr_core::{
    host::{SIGHT, Then, Vitality, World, keyed},
    mechanic::{
        Action, Band, CommitCtx, Cost, Module, Pos, PrepCtx, Prepared, Proposals, Senses, Target,
    },
};
use korr_ecs::EntityId;
use korr_engine::Registry;
use korr_hunger::config::BITE;
use korr_scenarios::{Bleeds, Clot, Wound, floor, game, nth, run};

use super::{Bleed, CARCASS, FIELD, MASS, SEED, laid, mass};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct Scavenge;

impl Action for Scavenge {
    const ALL: &'static [Self] = &[Self];

    fn name(self) -> &'static str {
        "scavenge"
    }
}

/// Eats a bite of the remains named `id` every turn, wherever they lie.
struct Scavenger {
    id: EntityId,
}

impl Module for Scavenger {
    const NAME: &'static str = "test.scavenger";
    type Action = Scavenge;
    type Plan = ();

    fn propose(&self, _: &Senses<'_>, out: &mut Proposals<'_, Scavenge>) {
        out.push(Scavenge, Band::Routine, 0, Target::None);
    }

    fn prepare(&self, _: Scavenge, _: Target, _: &PrepCtx<'_>) -> Prepared<Scavenge, ()> {
        Prepared::Go {
            cost: Cost::new(100),
            plan: (),
        }
    }

    fn commit(&self, (): (), ctx: &mut CommitCtx<'_>) {
        let _ = ctx.consume(self.id, BITE);
    }
}

/// The mass of remains that bleed out at `CARCASS` in round 1, after a
/// scavenger `dx` cells east of them takes its first turn.
fn scavenged(dx: u16) -> Option<u16> {
    let remains = nth(FIELD, 2);
    let game = game(
        Then(
            Then(
                keyed(Bleed::build),
                Registry {
                    wander: false,
                    hunger: false,
                    ..Registry::default()
                },
            ),
            Scavenger { id: remains },
        ),
        SEED,
    );
    let ruleset = game.ruleset();
    let mut f = floor(ruleset, FIELD, 10, 9);
    let h = f.spawn_actor(ruleset, CARCASS);
    f.init(ruleset.vitality(), h, Vitality { hp: 1, max: MASS });
    let (wound, clot) = game.mechanics().0.0.keys();
    f.insert(wound, h, Wound);
    f.insert(clot, h, Clot);
    let x = CARCASS.x + dx.cast_signed();
    f.spawn_actor(ruleset, Pos { x, ..CARCASS });
    let mut world = World::new(vec![f]);
    run(&game, &mut world, 1);
    assert_eq!(laid(&world), [remains]);
    mass(&game, &world, remains)
}

#[test]
fn remains_beyond_sight_are_not_eaten() {
    assert_eq!(scavenged(SIGHT), Some(MASS - BITE));
    assert_eq!(scavenged(SIGHT + 1), Some(MASS));
}
