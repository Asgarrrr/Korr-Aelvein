use std::panic::{AssertUnwindSafe, catch_unwind};

use korr_core::{
    host::{Floor, Game, Mechanics, Ruleset, Seed, TICKS_PER_ROUND, Visit, World, WorldError},
    mechanic::{
        Action, Band, CommitCtx, Cost, Dir, Module, Pos, PrepCtx, Prepared, Proposals, Senses,
        Target, Tick,
    },
};
use korr_ecs::{EntityId, FloorId, Handle};
use korr_scenarios::{Act, Answer, Fake, Leave, Scripted, floor, game, reload, run};

mod inbox;

const SEED: Seed = Seed(5);
const A: FloorId = FloorId(0);
const B: FloorId = FloorId(1);
const C: FloorId = FloorId(2);
const FREE: Pos = Pos { x: 3, y: 3 };
const TO_C: Leave = Leave {
    to: C,
    at: Pos { x: 2, y: 2 },
};

/// `actor` departs for `at` on floor `to` from tick `from`, unless already there.
#[derive(Debug)]
struct Home {
    actor: EntityId,
    from: Tick,
    to: FloorId,
    at: Pos,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum GoHome {
    Home,
}

impl Action for GoHome {
    const ALL: &'static [Self] = &[Self::Home];

    fn name(self) -> &'static str {
        "home"
    }
}

impl Module for Home {
    const NAME: &'static str = "keyed";
    type Action = GoHome;
    type Plan = ();

    fn propose(&self, _: &Senses<'_>, out: &mut Proposals<'_, GoHome>) {
        out.push(GoHome::Home, Band::Vigilance, 0, Target::None);
    }

    fn prepare(&self, _: GoHome, _: Target, ctx: &PrepCtx<'_>) -> Prepared<GoHome, ()> {
        if ctx.actor() == self.actor && ctx.now() >= self.from && ctx.floor() != self.to {
            Prepared::Go {
                cost: Cost::new(100),
                plan: (),
            }
        } else {
            Prepared::Fail
        }
    }

    fn commit(&self, (): (), ctx: &mut CommitCtx<'_>) {
        ctx.depart(self.to, self.at);
    }
}

/// `rest` for every actor, except when `home` goes.
#[derive(Debug)]
struct Keyed<M> {
    home: Home,
    rest: M,
}

impl<M: Mechanics> Mechanics for Keyed<M> {
    fn each<V: Visit>(&self, v: &mut V) {
        v.module(&self.home);
        self.rest.each(v);
    }
}

fn reload_all(ruleset: &Ruleset, world: &World) -> Vec<Floor> {
    world.floors().iter().map(|f| reload(ruleset, f)).collect()
}

/// Whether a copy of `floor` can still take a new actor at `at`.
fn has_room(ruleset: &Ruleset, floor: &Floor, at: Pos) -> bool {
    let mut copy = reload(ruleset, floor);
    catch_unwind(AssertUnwindSafe(|| copy.spawn_actor(ruleset, at))).is_ok()
}

/// A and B hold 3 actors each; C holds 8 and one free cell. Returns C's actors.
fn build(ruleset: &Ruleset, reversed: bool) -> (World, Vec<Handle>) {
    let mut a = floor(ruleset, A, 7, 7);
    let mut b = floor(ruleset, B, 7, 7);
    for x in 1..=3 {
        a.spawn_actor(ruleset, Pos { x, y: 1 });
        b.spawn_actor(ruleset, Pos { x, y: 1 });
    }
    let mut c = floor(ruleset, C, 5, 5);
    let natives = (1..=3)
        .flat_map(|y| (1..=3).map(move |x| Pos { x, y }))
        .filter(|&p| p != FREE)
        .map(|p| c.spawn_actor(ruleset, p))
        .collect();
    let mut floors = vec![a, b, c];
    if reversed {
        floors.reverse();
    }
    (World::new(floors), natives)
}

#[test]
fn floor_order_never_changes_arrivals() {
    let game = game(TO_C, SEED);
    let hashes = [false, true].map(|reversed| {
        let (mut world, natives) = build(game.ruleset(), reversed);
        run(&game, &mut world, 3);
        let c = world.floor(C);
        assert!(natives.iter().all(|&h| c.pos(h).is_some_and(|p| p != FREE)));
        // C has 9 interior cells: the natives hold 8, one arrival holds FREE.
        assert!(!has_room(game.ruleset(), c, FREE));
        // Every barrier retries the inbox: it stays at 5 only while C is full.
        assert_eq!(c.inbox_len(), 5);
        game.hash(&world)
    });
    assert_eq!(hashes[0], hashes[1]);
}

/// `TO_C`, except C0 leaves C for A from round 2.
fn homing() -> Game<Keyed<Leave>> {
    game(
        Keyed {
            home: Home {
                actor: EntityId::new(C, 0),
                from: Tick(2 * TICKS_PER_ROUND),
                to: A,
                at: Pos { x: 3, y: 3 },
            },
            rest: TO_C,
        },
        SEED,
    )
}

#[test]
fn save_with_travellers_waiting_replays() {
    let game = homing();
    let (mut direct, _) = build(game.ruleset(), false);
    run(&game, &mut direct, 3);

    let (mut world, _) = build(game.ruleset(), false);
    run(&game, &mut world, 1);
    let mut world = World::new(reload_all(game.ruleset(), &world));
    assert_eq!(world.floor(C).inbox_len(), 5);
    run(&game, &mut world, 2);
    assert_eq!(world.floor(C).inbox_len(), 4);
    assert_eq!(game.hash(&world), game.hash(&direct));
}

#[test]
fn equal_ticks_break_on_entity_id_not_slot() {
    let game = game(
        Keyed {
            home: Home {
                actor: EntityId::new(A, 0),
                from: Tick(0),
                to: B,
                at: Pos { x: 1, y: 1 },
            },
            rest: Scripted(vec![Act {
                action: Fake::X,
                band: Band::Routine,
                weight: 0,
                target: Target::None,
                answer: Answer::Go(Dir::East),
            }]),
        },
        SEED,
    );
    let ruleset = game.ruleset();
    let mut a = floor(ruleset, A, 9, 5);
    let leaver = a.spawn_actor(ruleset, Pos { x: 1, y: 1 });
    let older = a.spawn_actor(ruleset, Pos { x: 1, y: 2 });
    let mut world = World::new(vec![a, floor(ruleset, B, 5, 5)]);
    run(&game, &mut world, 1);
    assert_eq!(world.floor(A).pos(older), Some(Pos { x: 2, y: 2 }));

    let mut floors = reload_all(ruleset, &world);
    let newer = floors[0].spawn_actor(ruleset, Pos { x: 3, y: 2 });
    assert_eq!(newer.slot(), leaver.slot());
    let mut world = World::new(floors);
    run(&game, &mut world, 1);
    // Both step east at the same tick: older first finds (3,2) still held by newer.
    let a = world.floor(A);
    assert_eq!(a.pos(older), Some(Pos { x: 2, y: 2 }));
    assert_eq!(a.pos(newer), Some(Pos { x: 4, y: 2 }));
}

#[test]
fn floors_at_different_rounds_are_refused() {
    let game = game(TO_C, SEED);
    let mut world = World::new(vec![floor(game.ruleset(), A, 5, 5)]);
    run(&game, &mut world, 1);
    let mut floors = reload_all(game.ruleset(), &world);
    floors.push(floor(game.ruleset(), C, 5, 5));
    assert_eq!(World::try_new(floors).err(), Some(WorldError::Rounds));
}

/// Floors A and C after one round from one start: A's actor stays home, then
/// leaves for C, where it lands or, when C is full, waits. Both end at round 1.
fn histories(c_full: bool) -> [Vec<Floor>; 2] {
    [Tick(u64::MAX), Tick(0)].map(|from| {
        let game = game(
            Keyed {
                home: Home {
                    actor: EntityId::new(A, 0),
                    from,
                    to: TO_C.to,
                    at: TO_C.at,
                },
                rest: Scripted(Vec::new()),
            },
            SEED,
        );
        let ruleset = game.ruleset();
        let mut a = floor(ruleset, A, 5, 5);
        a.spawn_actor(ruleset, Pos { x: 1, y: 1 });
        let mut c = floor(ruleset, C, 5, 5);
        if c_full {
            for y in 1..=3 {
                for x in 1..=3 {
                    c.spawn_actor(ruleset, Pos { x, y });
                }
            }
        }
        let mut world = World::new(vec![a, c]);
        run(&game, &mut world, 1);
        reload_all(ruleset, &world)
    })
}

#[test]
fn an_entity_alive_on_two_floors_is_refused() {
    for c_full in [false, true] {
        let [mut stayed, mut left] = histories(c_full);
        assert_eq!(left[1].inbox_len(), usize::from(c_full));
        let floors = vec![stayed.remove(0), left.remove(1)];
        assert_eq!(
            World::try_new(floors).err(),
            Some(WorldError::DuplicateEntity(EntityId::new(A, 0)))
        );
    }
}
