#[expect(
    clippy::disallowed_types,
    reason = "a test observer, not engine state: it only records what propose is shown"
)]
use std::cell::RefCell;

use korr_core::{
    host::{SIGHT, Seed, World},
    mechanic::{
        Action, CommitCtx, Module, Pos, PrepCtx, Prepared, Proposals, Seen, Senses, Target,
    },
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

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Nothing {}

impl Action for Nothing {
    const ALL: &'static [Self] = &[];

    fn name(self) -> &'static str {
        match self {}
    }
}

impl Module for Watcher {
    const NAME: &'static str = "watcher";
    type Action = Nothing;
    type Plan = Nothing;

    fn perceives(&self) -> bool {
        self.perceives
    }

    fn propose(&self, senses: &Senses<'_>, _: &mut Proposals<'_, Nothing>) {
        self.shown
            .borrow_mut()
            .push((senses.pos(), senses.seen().to_vec()));
    }

    fn prepare(&self, action: Nothing, _: Target, _: &PrepCtx<'_>) -> Prepared<Nothing, Nothing> {
        match action {}
    }

    fn commit(&self, plan: Nothing, _: &mut CommitCtx<'_>) {
        match plan {}
    }
}

const CENTRE: Pos = Pos { x: 5, y: 5 };
const BEYOND_SIGHT: Pos = Pos { x: 9, y: 9 };

/// What every actor is shown in one round. Spawn order is id order and is
/// not neighbourhood order around `CENTRE`.
fn shown_in_a_round(perceives: bool) -> Vec<(Pos, Vec<Seen>)> {
    shown_around(
        perceives,
        [
            Pos { x: 5, y: 2 },
            BEYOND_SIGHT,
            Pos { x: 6, y: 5 },
            CENTRE,
            Pos { x: 4, y: 4 },
        ],
    )
}

#[expect(
    clippy::disallowed_types,
    reason = "a test observer, not engine state: it only records what propose is shown"
)]
fn shown_around(perceives: bool, spawns: impl IntoIterator<Item = Pos>) -> Vec<(Pos, Vec<Seen>)> {
    let game = game(
        Watcher {
            perceives,
            shown: RefCell::default(),
        },
        Seed(1),
    );
    let mut f = floor(game.ruleset(), FloorId(0), 11, 11);
    for at in spawns {
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
    // Ring 1 row above, ring 1 side, then ring 3 above: neither id nor row order.
    assert_eq!(
        seen_by(&shown, CENTRE),
        [seen(4, 4, 4), seen(2, 6, 5), seen(0, 5, 2)]
    );
    assert_eq!(seen_by(&shown, BEYOND_SIGHT), []);
}

/// Ties within a ring outnumber what an unstable sort keeps in order by luck.
#[test]
fn a_crowd_is_seen_ring_by_ring_then_row_by_row() {
    let sight = i16::try_from(SIGHT).expect("sight fits i16");
    let ring = |p: Pos| (p.x - CENTRE.x).abs().max((p.y - CENTRE.y).abs());
    let square: Vec<Pos> = (-sight..=sight)
        .flat_map(|dy| {
            (-sight..=sight).map(move |dx| Pos {
                x: CENTRE.x + dx,
                y: CENTRE.y + dy,
            })
        })
        .collect();
    let shown = shown_around(true, square.iter().rev().copied());
    let mut expected: Vec<Pos> = square.into_iter().filter(|&p| p != CENTRE).collect();
    expected.sort_by_key(|&p| (ring(p), p.y, p.x));
    let seen: Vec<Pos> = seen_by(&shown, CENTRE).iter().map(|s| s.pos).collect();
    assert_eq!(seen, expected);
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
    let mut f = floor(ruleset, FloorId(0), 30, 7);
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
