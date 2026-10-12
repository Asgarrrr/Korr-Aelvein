use korr_core::{
    host::{Cause, Event, Round, Seed, Then, World, keyed},
    mechanic::{
        Action, Band, Builder, CommitCtx, Component, Cost, ImageError, Module, Own, Pos, PrepCtx,
        Prepared, Proposals, Reader, Senses, Target, Writer,
    },
};
use korr_ecs::EntityId;
use korr_scenarios::{TO_GROUND, floor, game, run};

use super::{GROUND, MAX, UPPER, mortal, nth};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Lethal {
    Lethal,
}

impl Action for Lethal {
    const ALL: &'static [Self] = &[Self::Lethal];

    fn name(self) -> &'static str {
        "lethal"
    }
}

const HP: u16 = 40;

/// Every actor harms itself for `HP`.
struct Suicide;

impl Module for Suicide {
    const NAME: &'static str = "suicide";
    type Action = Lethal;
    type Plan = EntityId;

    fn propose(&self, _: &Senses<'_>, out: &mut Proposals<'_, Lethal>) {
        out.push(Lethal::Lethal, Band::Routine, 0, Target::None);
    }

    fn prepare(&self, _: Lethal, _: Target, ctx: &PrepCtx<'_>) -> Prepared<Lethal, EntityId> {
        Prepared::Go {
            cost: Cost::new(100),
            plan: ctx.actor(),
        }
    }

    fn commit(&self, id: EntityId, ctx: &mut CommitCtx<'_>) {
        ctx.harm(id, HP);
    }
}

#[test]
fn an_actor_killed_by_its_own_action_is_not_rescheduled() {
    let game = game(Suicide, Seed(1));
    let ruleset = game.ruleset();
    let mut f = floor(ruleset, GROUND, 5, 5);
    let h = mortal(&mut f, ruleset, Pos { x: 1, y: 1 }, HP, MAX);
    f.spawn_actor(ruleset, Pos { x: 3, y: 3 });
    let mut world = World::new(vec![f]);
    run(&game, &mut world, 1);
    assert_eq!(world.floor(GROUND).pos(h), None);
    let dead = nth(GROUND, 0);
    assert!(matches!(
        *world.floor(GROUND).events(),
        [Event::Died { id, cause: Cause::Entity(by) }, Event::Spawned { .. }]
            if id == dead && by == dead
    ));
    run(&game, &mut world, 3);
    assert_eq!(world.floor(GROUND).round(), Round(4));
}

#[derive(Debug)]
struct Fang;

impl Component for Fang {
    const VERSION: u16 = 0;

    fn write(&self, _: &mut Writer) {}

    fn read(_: &mut Reader<'_>) -> Result<Self, ImageError> {
        Ok(Self)
    }
}

/// An actor with a fang harms the first actor it sees for 255.
struct Striker {
    fang: Own<Fang>,
}

impl Striker {
    fn build(b: &mut Builder<'_>) -> Self {
        Self {
            fang: b.own("fang"),
        }
    }
}

impl Module for Striker {
    const NAME: &'static str = "striker";
    type Action = Lethal;
    type Plan = EntityId;

    fn perceives(&self) -> bool {
        true
    }

    fn propose(&self, senses: &Senses<'_>, out: &mut Proposals<'_, Lethal>) {
        if senses.get(self.fang.read()).is_none() {
            return;
        }
        if let Some(seen) = senses.seen().first() {
            out.push(Lethal::Lethal, Band::Routine, 2, Target::Entity(seen.id));
        }
    }

    fn prepare(&self, _: Lethal, target: Target, ctx: &PrepCtx<'_>) -> Prepared<Lethal, EntityId> {
        match target {
            Target::Entity(id) if ctx.locate(id).is_some() => Prepared::Go {
                cost: Cost::new(100),
                plan: id,
            },
            _ => Prepared::Fail,
        }
    }

    fn commit(&self, id: EntityId, ctx: &mut CommitCtx<'_>) {
        ctx.harm(id, 255);
    }
}

/// The ground's one interior cell is held, so an arrival there would wait.
#[test]
fn an_actor_killed_after_it_departs_stays_dead() {
    let game = game(Then(keyed(Striker::build), TO_GROUND), Seed(1));
    let ruleset = game.ruleset();
    let mut ground = floor(ruleset, GROUND, 3, 3);
    ground.spawn_actor(ruleset, Pos { x: 1, y: 1 });
    let mut upper = floor(ruleset, UPPER, 5, 5);
    let victim = mortal(&mut upper, ruleset, Pos { x: 1, y: 1 }, MAX, MAX);
    let striker = upper.spawn_actor(ruleset, Pos { x: 2, y: 1 });
    upper.init(ruleset, striker, "striker.fang", Fang);
    let mut world = World::new(vec![ground, upper]);
    run(&game, &mut world, 1);
    let (ground, upper) = (world.floor(GROUND), world.floor(UPPER));
    assert_eq!(upper.pos(victim), None);
    assert_eq!(ground.inbox_len(), 0);
    assert!(matches!(
        *upper.events(),
        [Event::Died { id, cause: Cause::Entity(by) }, Event::Spawned { .. }]
            if id == nth(UPPER, 0) && by == nth(UPPER, 1)
    ));
}
