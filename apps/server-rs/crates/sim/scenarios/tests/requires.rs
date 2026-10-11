use korr_core::{
    host::{Game, Seed, World},
    mechanic::{
        Action, Band, CommitCtx, Cost, Dir, Module, Pos, PrepCtx, Prepared, Proposals, Senses,
        Target,
    },
};
use korr_ecs::{Component, FloorId, ImageError, Reader, SchemaBuilder, Writer};
use korr_scenarios::{floor, run};

struct Mark;

impl Component for Mark {
    const VERSION: u16 = 0;

    fn write(&self, _: &mut Writer) {}

    fn read(_: &mut Reader<'_>) -> Result<Self, ImageError> {
        Ok(Self)
    }
}

/// Prefers east, which only a marked actor may take; west needs nothing.
#[derive(Debug)]
struct Marked;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Step {
    East,
    West,
}

impl Step {
    fn dir(self) -> Dir {
        match self {
            Self::East => Dir::East,
            Self::West => Dir::West,
        }
    }
}

impl Action for Step {
    const ALL: &'static [Self] = &[Self::East, Self::West];

    fn name(self) -> &'static str {
        match self {
            Self::East => "east",
            Self::West => "west",
        }
    }
}

impl Module for Marked {
    const NAME: &'static str = "marked";
    type Action = Step;
    type Plan = Dir;

    fn requires(action: Step) -> &'static [&'static str] {
        match action {
            Step::East => &["test.mark"],
            Step::West => &[],
        }
    }

    fn propose(&self, _: &Senses<'_>, out: &mut Proposals<'_, Step>) {
        out.push(Step::East, Band::Routine, 2, Target::None);
        out.push(Step::West, Band::Routine, 1, Target::None);
    }

    fn prepare(&self, step: Step, _: Target, ctx: &PrepCtx<'_>) -> Prepared<Step, Dir> {
        match ctx.check_step(step.dir()) {
            Ok(_) => Prepared::Go {
                cost: Cost::new(100),
                plan: step.dir(),
            },
            Err(_) => Prepared::Blocked,
        }
    }

    fn commit(&self, dir: Dir, ctx: &mut CommitCtx<'_>) {
        ctx.step(dir);
    }
}

#[test]
fn a_missing_requirement_fails_the_action() {
    let mut schema = SchemaBuilder::default();
    let mark = schema.register::<Mark>("test.mark");
    let game = Game::new(schema, Marked, Seed(1));
    let mut f = floor(game.ruleset(), 0, 9, 9);
    let m = f.spawn_actor(game.ruleset(), Pos { x: 4, y: 4 });
    f.insert(&mark, m, Mark);
    let u = f.spawn_actor(game.ruleset(), Pos { x: 4, y: 6 });
    let mut world = World::new(vec![f]);
    run(&game, &mut world, 1);
    let floor = world.floor(FloorId(0));
    assert_eq!(floor.pos(m), Some(Pos { x: 5, y: 4 }));
    assert_eq!(floor.pos(u), Some(Pos { x: 3, y: 6 }));
}

#[test]
#[should_panic(expected = "requires test.mark")]
fn an_unregistered_requirement_panics() {
    let _ = Game::new(SchemaBuilder::default(), Marked, Seed(1));
}

/// Proposes only `Start`, which hands over to `Gated`: east, for a marked actor only.
#[derive(Debug)]
struct Hop;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Hopping {
    Start,
    Gated,
}

impl Action for Hopping {
    const ALL: &'static [Self] = &[Self::Start, Self::Gated];

    fn name(self) -> &'static str {
        match self {
            Self::Start => "start",
            Self::Gated => "gated",
        }
    }
}

impl Module for Hop {
    const NAME: &'static str = "hop";
    type Action = Hopping;
    type Plan = ();

    fn requires(action: Hopping) -> &'static [&'static str] {
        match action {
            Hopping::Start => &[],
            Hopping::Gated => &["test.mark"],
        }
    }

    fn propose(&self, _: &Senses<'_>, out: &mut Proposals<'_, Hopping>) {
        out.push(Hopping::Start, Band::Routine, 1, Target::None);
    }

    fn prepare(&self, action: Hopping, _: Target, ctx: &PrepCtx<'_>) -> Prepared<Hopping, ()> {
        match action {
            Hopping::Start => Prepared::Instead {
                action: Hopping::Gated,
                target: Target::None,
            },
            Hopping::Gated => match ctx.check_step(Dir::East) {
                Ok(_) => Prepared::Go {
                    cost: Cost::new(100),
                    plan: (),
                },
                Err(_) => Prepared::Blocked,
            },
        }
    }

    fn commit(&self, (): (), ctx: &mut CommitCtx<'_>) {
        ctx.step(Dir::East);
    }
}

#[test]
fn a_redirect_to_an_action_the_actor_lacks_the_component_for_fails() {
    let mut schema = SchemaBuilder::default();
    let mark = schema.register::<Mark>("test.mark");
    let game = Game::new(schema, Hop, Seed(1));
    let mut f = floor(game.ruleset(), 0, 9, 9);
    let m = f.spawn_actor(game.ruleset(), Pos { x: 4, y: 4 });
    f.insert(&mark, m, Mark);
    let u = f.spawn_actor(game.ruleset(), Pos { x: 4, y: 6 });
    let mut world = World::new(vec![f]);
    run(&game, &mut world, 1);
    let floor = world.floor(FloorId(0));
    assert_eq!(floor.pos(m), Some(Pos { x: 5, y: 4 }));
    assert_eq!(floor.pos(u), Some(Pos { x: 4, y: 6 }));
}
