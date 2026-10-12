use core::convert::Infallible;

use korr_contracts::Appetite;
use korr_core::{
    host::{
        Cause, Event, Floor, Game, Mechanics, ModuleKey, ROT_PER_ROUND, Recipe, Remains, Round,
        Ruleset, Seed, Then, Vitality, World, keyed,
    },
    mechanic::{
        Action, Band, Builder, CommitCtx, Component, Contract, Cost, ImageError, Module, Own, Pos,
        PrepCtx, Prepared, Proposals, Reader, Rows, Senses, Target, Writer,
    },
};
use korr_ecs::{EntityId, FloorId, Handle};
use korr_hunger::config::STARVE_DAMAGE;
use korr_hunger::{Hunger, Satiety};
use korr_scenarios::{Pace, TO_GROUND, floor, game, run};

const GROUND: FloorId = FloorId(0);
const UPPER: FloorId = FloorId(1);
const HUNGER: Cause = Cause::Mechanic(ModuleKey::of("hunger"));
const MAX: u16 = 10;

/// Spawn order is id order.
fn nth(floor: FloorId, n: u64) -> EntityId {
    EntityId::new(floor, n)
}

fn mortal(f: &mut Floor, ruleset: &Ruleset, at: Pos, hp: u16, max: u16) -> Handle {
    let h = f.spawn_actor(ruleset, at);
    f.init(ruleset, h, "core.vitality", Vitality { hp, max });
    h
}

fn starve(f: &mut Floor, ruleset: &Ruleset, h: Handle) {
    f.init(ruleset, h, "hunger.satiety", Satiety(0));
    f.init(ruleset, h, Appetite::NAME, Appetite { urgency: 0 });
}

fn hunger() -> Game<Hunger> {
    game(keyed(Hunger::build), Seed(1))
}

/// One empty stomach on a 5x5 floor, with `hp` and `MAX`.
fn starving<M: Mechanics>(game: &Game<M>, hp: u16) -> (World, Handle) {
    let ruleset = game.ruleset();
    let mut f = floor(ruleset, GROUND, 5, 5);
    let h = mortal(&mut f, ruleset, Pos { x: 2, y: 2 }, hp, MAX);
    starve(&mut f, ruleset, h);
    (World::new(vec![f]), h)
}

/// The id of the remains a starving creature leaves in round 2.
fn starved(game: &Game<Hunger>, world: &mut World) -> EntityId {
    run(game, world, 2);
    match world.floor(GROUND).events() {
        [Event::Died { .. }, Event::Spawned { id, .. }] => *id,
        other => panic!("one death and its remains, not {other:?}"),
    }
}

#[test]
fn a_starving_creature_dies_and_leaves_remains() {
    let game = hunger();
    let (mut world, h) = starving(&game, 2 * STARVE_DAMAGE);
    run(&game, &mut world, 1);
    assert!(world.floor(GROUND).pos(h).is_some());
    assert_eq!(world.floor(GROUND).events(), []);
    run(&game, &mut world, 1);
    let f = world.floor(GROUND);
    assert_eq!(f.pos(h), None);
    let dead = nth(GROUND, 0);
    let [
        Event::Died { id, cause },
        Event::Spawned {
            id: remains,
            cause: spawned,
        },
    ] = *f.events()
    else {
        panic!("one death and its remains, not {:?}", f.events());
    };
    assert_eq!((id, cause, spawned), (dead, HUNGER, HUNGER));
    assert_eq!(
        f.remains(game.ruleset(), remains),
        Some(&Remains {
            of: dead,
            mass: MAX
        })
    );
}

#[test]
fn remains_rot_away() {
    let game = hunger();
    let (mut world, _) = starving(&game, 2 * STARVE_DAMAGE);
    let remains = starved(&game, &mut world);
    let rounds = u64::from(MAX.div_ceil(ROT_PER_ROUND));
    run(&game, &mut world, rounds - 1);
    assert!(
        world
            .floor(GROUND)
            .remains(game.ruleset(), remains)
            .is_some()
    );
    run(&game, &mut world, 1);
    assert_eq!(world.floor(GROUND).remains(game.ruleset(), remains), None);
}

#[test]
fn starvation_in_the_bulk_phase_before_the_due_pops_does_not_panic() {
    let game = game(Then(Pace, keyed(Hunger::build)), Seed(1));
    let (mut world, h) = starving(&game, STARVE_DAMAGE);
    run(&game, &mut world, 1);
    assert_eq!(world.floor(GROUND).pos(h), None);
    assert!(matches!(
        world.floor(GROUND).events(),
        [Event::Died { cause: HUNGER, .. }, ..]
    ));
    run(&game, &mut world, 2);
    assert_eq!(world.floor(GROUND).round(), Round(3));
    assert_eq!(
        world.floor(GROUND).events(),
        [],
        "a round reports only its own events"
    );
}

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

/// Six creatures that starve one by one, every third round from round 3,
/// each leaving remains that outlast a few rounds.
fn famine(game: &Game<impl Mechanics>) -> World {
    let ruleset = game.ruleset();
    let mut f = floor(ruleset, GROUND, 9, 9);
    for k in 1..=6 {
        let y = i16::try_from(k).expect("a row fits i16");
        let h = mortal(&mut f, ruleset, Pos { x: 1, y }, 3 * k * STARVE_DAMAGE, 5);
        starve(&mut f, ruleset, h);
    }
    World::new(vec![f])
}

#[test]
fn a_save_mid_famine_replays_the_uninterrupted_run() {
    let game = game(Then(Pace, keyed(Hunger::build)), Seed(1));
    let mut unbroken = famine(&game);
    run(&game, &mut unbroken, 20);
    let mut resumed = famine(&game);
    run(&game, &mut resumed, 10);
    let mut resumed = game.load(&game.save(&resumed)).expect("own save loads");
    run(&game, &mut resumed, 10);
    assert_eq!(game.hash(&resumed), game.hash(&unbroken));
}
