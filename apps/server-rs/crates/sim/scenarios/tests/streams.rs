use core::num::NonZeroU32;

use korr_core::{
    host::{Game, Mechanics, Seed, Visit, World},
    mechanic::{
        Action, Band, CommitCtx, DrawIndex, Module, Pos, PrepCtx, Prepared, Proposals, Senses,
        Target,
    },
};
use korr_ecs::{FloorId, Handle};
use korr_scenarios::{Shy, floor, game, run};

/// Outranks `Shy`, draws, then fails, so `Shy` still runs every turn.
#[derive(Debug)]
struct Dud;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Flinch {
    Flinch,
}

impl Action for Flinch {
    const ALL: &'static [Self] = &[Self::Flinch];

    fn name(self) -> &'static str {
        "flinch"
    }
}

impl Module for Dud {
    const NAME: &'static str = "dud";
    type Action = Flinch;
    type Plan = ();

    fn propose(&self, _: &Senses<'_>, out: &mut Proposals<'_, Flinch>) {
        out.push(Flinch::Flinch, Band::Vigilance, 1, Target::None);
    }

    fn prepare(&self, _: Flinch, _: Target, ctx: &PrepCtx<'_>) -> Prepared<Flinch, ()> {
        let any = NonZeroU32::new(u32::MAX).expect("nonzero");
        let _ = ctx.below(DrawIndex(0), any);
        Prepared::Fail
    }

    fn commit(&self, (): (), _: &mut CommitCtx<'_>) {}
}

#[derive(Debug)]
struct DudThenShy;

impl Mechanics for DudThenShy {
    fn each<V: Visit>(&self, v: &mut V) {
        v.module(&Dud);
        v.module(&Shy);
    }
}

const START: [Pos; 2] = [Pos { x: 5, y: 5 }, Pos { x: 6, y: 5 }];

fn paths<M: Mechanics>(game: &Game<M>) -> Vec<Pos> {
    let mut f = floor(game.ruleset(), 0, 12, 12);
    let actors: Vec<Handle> = START
        .iter()
        .map(|&p| f.spawn_actor(game.ruleset(), p))
        .collect();
    let mut world = World::new(vec![f]);
    let mut seen = Vec::new();
    for _ in 0..10 {
        run(game, &mut world, 1);
        let floor = world.floor(FloorId(0));
        seen.extend(actors.iter().map(|&h| floor.pos(h).expect("placed")));
    }
    seen
}

#[test]
fn a_module_added_before_another_leaves_its_draws_unchanged() {
    let alone = paths(&game(Shy, Seed(3)));
    assert!(alone[..2] != START, "shy actors that see each other move");
    assert_eq!(paths(&game(DudThenShy, Seed(3))), alone);
}
