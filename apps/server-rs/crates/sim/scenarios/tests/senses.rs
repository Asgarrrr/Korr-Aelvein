#[expect(
    clippy::disallowed_types,
    reason = "a test observer, not engine state: it only records what propose is shown"
)]
use std::cell::RefCell;

use korr_core::{
    ActionDesc, Candidates, CommitCtx, Mechanics, Pos, PrepCtx, Prepared, Seed, Seen, Senses,
    Target, World,
};
use korr_ecs::{EntityId, FloorId};
use korr_scenarios::{Shy, floor, game};

/// Proposes nothing and records what each actor is shown, in turn order.
#[derive(Debug)]
#[expect(
    clippy::disallowed_types,
    reason = "a test observer, not engine state: it only records what propose is shown"
)]
struct Watcher {
    perceives: bool,
    shown: RefCell<Vec<(Pos, Vec<Seen>)>>,
}

impl Mechanics for Watcher {
    fn actions(&self, _: &mut Vec<&'static ActionDesc>) {}

    fn perceives(&self) -> bool {
        self.perceives
    }

    fn propose(&self, senses: &Senses<'_>, _: &mut Candidates) {
        self.shown
            .borrow_mut()
            .push((senses.pos(), senses.seen().to_vec()));
    }

    fn prepare(&self, _: &'static ActionDesc, _: Target, _: &PrepCtx<'_>) -> Prepared {
        unreachable!("the watcher proposes nothing")
    }

    fn commit(&self, _: &'static ActionDesc, _: Target, _: &mut CommitCtx<'_>) {
        unreachable!("the watcher proposes nothing")
    }
}

const CENTRE: Pos = Pos { x: 5, y: 5 };
const BEYOND_SIGHT: Pos = Pos { x: 9, y: 9 };

/// What every actor is shown in one round. Spawn order is id order and is
/// not neighbourhood order around `CENTRE`.
#[expect(
    clippy::disallowed_types,
    reason = "a test observer, not engine state: it only records what propose is shown"
)]
fn shown_in_a_round(perceives: bool) -> Vec<(Pos, Vec<Seen>)> {
    let game = game(
        Watcher {
            perceives,
            shown: RefCell::default(),
        },
        Seed(1),
    );
    let mut f = floor(game.ruleset(), 0, 11, 11);
    for at in [
        Pos { x: 5, y: 8 },
        BEYOND_SIGHT,
        Pos { x: 6, y: 5 },
        CENTRE,
        Pos { x: 4, y: 4 },
    ] {
        f.spawn_actor(game.ruleset(), at);
    }
    let mut world = World::new(vec![f]);
    game.run_round(&mut world);
    game.mechanics().shown.take()
}

fn seen_by(shown: &[(Pos, Vec<Seen>)], at: Pos) -> &[Seen] {
    &shown
        .iter()
        .find(|(pos, _)| *pos == at)
        .expect("an actor stands there")
        .1
}

#[test]
fn perceiving_mechanics_see_the_others_in_neighbourhood_order() {
    let shown = shown_in_a_round(true);
    let seen = |n, x, y| Seen {
        id: EntityId::new(FloorId(0), n),
        pos: Pos { x, y },
    };
    // Ring 1 row above, ring 1 side, then ring 3 below: not id order.
    assert_eq!(
        seen_by(&shown, CENTRE),
        [seen(4, 4, 4), seen(2, 6, 5), seen(0, 5, 8)]
    );
    assert_eq!(seen_by(&shown, BEYOND_SIGHT), []);
}

#[test]
fn non_perceiving_mechanics_are_shown_nobody() {
    let shown = shown_in_a_round(false);
    assert_eq!(shown.len(), 5);
    assert!(shown.iter().all(|(_, seen)| seen.is_empty()));
}

#[test]
fn sight_bounds_perception() {
    let game = game(Shy, Seed(1));
    let ruleset = game.ruleset();
    let mut f = floor(ruleset, 0, 30, 7);
    let at = |x| Pos { x, y: 3 };
    // Pairs a sight apart see each other; pairs one cell farther do not.
    let lone = f.spawn_actor(ruleset, at(3));
    let p1 = f.spawn_actor(ruleset, at(12));
    let _p2 = f.spawn_actor(ruleset, at(15));
    let q1 = f.spawn_actor(ruleset, at(22));
    let q2 = f.spawn_actor(ruleset, at(26));
    let mut world = World::new(vec![f]);
    game.run_round(&mut world);
    let f = world.floor(FloorId(0));
    assert_eq!(f.pos(lone), Some(at(3)));
    assert_eq!(f.pos(q1), Some(at(22)));
    assert_eq!(f.pos(q2), Some(at(26)));
    assert_ne!(f.pos(p1), Some(at(12)));
}
