use korr_core::{
    host::{Game, SIGHT, Seed, Then, World, keyed},
    mechanic::{
        Action, Band, Builder, CommitCtx, Component, Cost, Dir, ImageError, Module, Own, Pos,
        PrepCtx, Prepared, Proposals, Reader, Senses, Target, Writer,
    },
};
use korr_ecs::{EntityId, FloorId, Handle};
use korr_scenarios::{TO_GROUND, floor, game, run};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct Mark(u8);

impl Component for Mark {
    const VERSION: u16 = 0;

    fn write(&self, w: &mut Writer) {
        w.write_u8(self.0);
    }

    fn read(r: &mut Reader<'_>) -> Result<Self, ImageError> {
        r.read_u8().map(Self)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Follow {
    Follow,
}

impl Action for Follow {
    const ALL: &'static [Self] = &[Self::Follow];

    fn name(self) -> &'static str {
        "follow"
    }
}

/// One step toward `target`, or `unresolved` when it does not resolve.
fn step_toward(
    target: Target,
    ctx: &PrepCtx<'_>,
    unresolved: Prepared<Follow, Dir>,
) -> Prepared<Follow, Dir> {
    let Target::Entity(id) = target else {
        return Prepared::Fail;
    };
    let Some(at) = ctx.locate(id) else {
        return unresolved;
    };
    let pos = ctx.pos();
    let offset = ((at.x - pos.x).signum(), (at.y - pos.y).signum());
    let Some(dir) = Dir::ALL.into_iter().find(|dir| dir.offset() == offset) else {
        return Prepared::Fail;
    };
    match ctx.check_step(dir) {
        Ok(_) => Prepared::Go {
            cost: Cost::new(100),
            plan: dir,
        },
        Err(_) => Prepared::Blocked,
    }
}

/// Follows the seen actor with the highest mark; ties go to the first seen.
#[derive(Debug)]
struct Tail {
    mark: Own<Mark>,
}

impl Tail {
    fn build(b: &mut Builder<'_>) -> Self {
        Self {
            mark: b.own("mark"),
        }
    }
}

impl Module for Tail {
    const NAME: &'static str = "tail";
    type Action = Follow;
    type Plan = Dir;

    fn perceives(&self) -> bool {
        true
    }

    fn propose(&self, senses: &Senses<'_>, out: &mut Proposals<'_, Follow>) {
        let mark = self.mark.read();
        let leader = senses
            .seen()
            .iter()
            .rev()
            .filter_map(|seen| senses.get_seen(mark, seen).map(|m| (m.0, seen.id)))
            .max_by_key(|&(m, _)| m);
        if let Some((_, id)) = leader {
            out.push(Follow::Follow, Band::Routine, 0, Target::Entity(id));
        }
    }

    fn prepare(&self, _: Follow, target: Target, ctx: &PrepCtx<'_>) -> Prepared<Follow, Dir> {
        step_toward(target, ctx, Prepared::Fail)
    }

    fn commit(&self, dir: Dir, ctx: &mut CommitCtx<'_>) {
        ctx.step(dir);
    }
}

/// Every actor steps toward `target`, and holds still while it does not resolve.
#[derive(Debug)]
struct Fixed {
    target: EntityId,
}

impl Module for Fixed {
    const NAME: &'static str = "fixed";
    type Action = Follow;
    type Plan = Dir;

    fn propose(&self, _: &Senses<'_>, out: &mut Proposals<'_, Follow>) {
        out.push(
            Follow::Follow,
            Band::Routine,
            2,
            Target::Entity(self.target),
        );
    }

    fn prepare(&self, _: Follow, target: Target, ctx: &PrepCtx<'_>) -> Prepared<Follow, Dir> {
        step_toward(target, ctx, Prepared::Blocked)
    }

    fn commit(&self, dir: Dir, ctx: &mut CommitCtx<'_>) {
        ctx.step(dir);
    }
}

const GROUND: FloorId = FloorId(0);

/// Spawn order is id order.
fn nth(floor: FloorId, n: u64) -> EntityId {
    EntityId::new(floor, n)
}

fn tail_game() -> Game<Tail> {
    game(keyed(Tail::build), Seed(3))
}

#[test]
fn tail_follows_the_highest_mark() {
    let game = tail_game();
    let ruleset = game.ruleset();
    let mut f = floor(ruleset, GROUND, 11, 11);
    let follower = f.spawn_actor(ruleset, Pos { x: 5, y: 5 });
    let low = f.spawn_actor(ruleset, Pos { x: 4, y: 5 });
    f.insert(&game.mechanics().mark, low, Mark(1));
    let high = f.spawn_actor(ruleset, Pos { x: 7, y: 5 });
    f.insert(&game.mechanics().mark, high, Mark(2));
    let mut world = World::new(vec![f]);
    run(&game, &mut world, 1);
    assert_eq!(world.floor(GROUND).pos(follower), Some(Pos { x: 6, y: 5 }));
}

/// The first actor's position after `rounds` under `Fixed { target }`.
fn fixed_lead_after(target: EntityId, spawns: &[Pos], rounds: u64) -> Option<Pos> {
    let game = game(Fixed { target }, Seed(3));
    let ruleset = game.ruleset();
    let mut f = floor(ruleset, GROUND, 12, 11);
    let lead = spawns
        .iter()
        .map(|&at| f.spawn_actor(ruleset, at))
        .collect::<Vec<Handle>>()[0];
    let mut world = World::new(vec![f]);
    run(&game, &mut world, rounds);
    world.floor(GROUND).pos(lead)
}

#[test]
fn a_target_resolves_up_to_sight_and_not_past_it() {
    let start = Pos { x: 2, y: 5 };
    let edge = start.x + i16::try_from(SIGHT).expect("SIGHT fits a coordinate");
    let at_edge = [start, Pos { x: edge, y: 5 }];
    let past_edge = [start, Pos { x: edge + 1, y: 5 }];
    assert_eq!(
        fixed_lead_after(nth(GROUND, 1), &at_edge, 1),
        Some(Pos { x: 3, y: 5 })
    );
    assert_eq!(fixed_lead_after(nth(GROUND, 1), &past_edge, 1), Some(start));
}

#[test]
fn a_never_allocated_target_does_not_resolve() {
    let start = Pos { x: 2, y: 5 };
    let spawns = [start, Pos { x: 4, y: 5 }];
    assert_eq!(fixed_lead_after(nth(GROUND, 99), &spawns, 3), Some(start));
}

#[test]
fn a_target_gone_to_another_floor_does_not_resolve() {
    const UPPER: FloorId = FloorId(1);
    let game = game(
        Then(
            Fixed {
                target: nth(UPPER, 1),
            },
            TO_GROUND,
        ),
        Seed(3),
    );
    let ruleset = game.ruleset();
    let ground = floor(ruleset, GROUND, 5, 5);
    let mut upper = floor(ruleset, UPPER, 11, 11);
    let start = Pos { x: 4, y: 5 };
    let holder = upper.spawn_actor(ruleset, start);
    let leaver = upper.spawn_actor(ruleset, Pos { x: 5, y: 5 });
    let mut world = World::new(vec![ground, upper]);
    run(&game, &mut world, 3);
    let upper = world.floor(UPPER);
    assert_eq!(upper.pos(leaver), None, "the target left");
    assert_eq!(upper.pos(holder), Some(start));
}

/// Eight actors, marked 0 to 2, some within sight of each other.
fn marked(game: &Game<Tail>) -> World {
    let ruleset = game.ruleset();
    let mut f = floor(ruleset, GROUND, 16, 16);
    let spawns = [
        (3, 3),
        (6, 4),
        (9, 3),
        (12, 5),
        (4, 8),
        (8, 9),
        (12, 11),
        (5, 13),
    ];
    for (n, (x, y)) in (0..).zip(spawns) {
        let h = f.spawn_actor(ruleset, Pos { x, y });
        f.insert(&game.mechanics().mark, h, Mark(n % 3));
    }
    World::new(vec![f])
}

#[test]
fn entity_targets_survive_a_reload_every_round() {
    let game = tail_game();
    let mut unbroken = marked(&game);
    run(&game, &mut unbroken, 12);
    let mut resumed = marked(&game);
    for _ in 0..12 {
        run(&game, &mut resumed, 1);
        resumed = game.load(&game.save(&resumed)).expect("own save loads");
    }
    assert_eq!(game.hash(&resumed), game.hash(&unbroken));
}
