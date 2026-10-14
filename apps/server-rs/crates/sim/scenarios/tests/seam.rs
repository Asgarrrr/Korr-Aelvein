use core::convert::Infallible;

use korr_core::{
    host::{Assembly, Both, Declarations, Recipe, Seed, Then, World, keyed},
    mechanic::{
        Band, Builder, CellContract, CommitCtx, Component, Contract, Cost, Dir, ImageError, Module,
        Pos, PrepCtx, Prepared, Proposals, Provided, Read, Reader, Senses, Target, Writer,
        provides, provides_cells,
    },
};
use korr_ecs::FloorId;
use korr_scenarios::{Step, actionless, floor, game, run};

/// The three callbacks of a module that never proposes.
macro_rules! inert {
    () => {
        type Action = Infallible;
        type Plan = Infallible;

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
    };
}

/// Declares `$ty`, a one-byte contract named `$name`.
macro_rules! contract {
    ($ty:ident, $name:literal) => {
        #[derive(Debug, Clone, Copy, PartialEq, Eq)]
        struct $ty(u8);

        impl Component for $ty {
            const VERSION: u16 = 0;

            fn write(&self, w: &mut Writer) {
                w.write_u8(self.0);
            }

            fn read(r: &mut Reader<'_>) -> Result<Self, ImageError> {
                r.read_u8().map(Self)
            }
        }

        impl Contract for $ty {
            const NAME: &'static str = $name;
        }
    };
}

contract!(Scent, "test.scent");
contract!(Musk, "test.musk");
contract!(Forged, "test.scent");
contract!(Silt, "test.silt");

impl CellContract for Silt {
    const NAME: &'static str = "test.silt";
}

/// Steps east only while it holds the scent 3.
#[derive(Debug)]
struct Sniffer {
    scent: Option<Read<Scent>>,
}

impl Sniffer {
    fn build(b: &mut Builder<'_>) -> Self {
        Self {
            scent: b.contract(),
        }
    }
}

impl Module for Sniffer {
    const NAME: &'static str = "sniffer";
    type Action = Step;
    type Plan = ();

    fn propose(&self, senses: &Senses<'_>, out: &mut Proposals<'_, Step>) {
        if self.scent.and_then(|key| senses.get(key)) == Some(&Scent(3)) {
            out.push(Step::Step, Band::Routine, 0, Target::None);
        }
    }

    fn prepare(&self, _: Step, _: Target, ctx: &PrepCtx<'_>) -> Prepared<Step, ()> {
        match ctx.check_step(Dir::East) {
            Ok(_) => Prepared::Go {
                cost: Cost::new(100),
                plan: (),
            },
            Err(_) => Prepared::Blocked,
        }
    }

    fn commit(&self, (): (), ctx: &mut CommitCtx<'_>) {
        ctx.step(Dir::East);
    }
}

/// Provides `Scent` and keeps no key: the test seeds it through the sniffer's key.
#[derive(Debug)]
struct Scenter;

impl Scenter {
    fn build(b: &mut Builder<'_>) -> Self {
        b.provide::<Scent>();
        Self
    }
}

impl Module for Scenter {
    const NAME: &'static str = "scenter";
    const PROVIDES: &'static [Provided] = &[provides::<Scent>()];
    inert!();
}

#[test]
fn a_reader_listed_before_its_provider_reads_the_contract() {
    let game = game(Then(keyed(Sniffer::build), keyed(Scenter::build)), Seed(1));
    let ruleset = game.ruleset();
    let mut f = floor(ruleset, FloorId(0), 9, 9);
    let scent = game
        .mechanics()
        .0
        .scent
        .expect("scenter provides the scent");
    let scented = f.spawn_actor(ruleset, Pos { x: 2, y: 2 });
    f.init(scent, scented, Scent(3));
    let faint = f.spawn_actor(ruleset, Pos { x: 2, y: 5 });
    f.init(scent, faint, Scent(2));
    let mut world = World::new(vec![f]);
    run(&game, &mut world, 1);
    let f = world.floor(FloorId(0));
    assert_eq!(f.pos(scented), Some(Pos { x: 3, y: 2 }));
    assert_eq!(f.pos(faint), Some(Pos { x: 2, y: 5 }));
}

#[derive(Debug)]
struct Rival;

impl Module for Rival {
    const NAME: &'static str = "rival";
    const PROVIDES: &'static [Provided] = &[provides::<Scent>()];
    inert!();
}

#[test]
#[should_panic(expected = "contract test.scent provided by scenter and rival")]
fn two_providers_panic() {
    let _ = game(
        Then(
            keyed(Scenter::build),
            keyed(|b| {
                b.provide::<Scent>();
                Rival
            }),
        ),
        Seed(1),
    );
}

#[derive(Debug)]
struct Forger;

impl Module for Forger {
    const NAME: &'static str = "forger";
    const PROVIDES: &'static [Provided] = &[provides::<Forged>()];
    inert!();
}

#[test]
#[should_panic(expected = "contract test.scent bound to two types")]
fn one_name_bound_to_two_types_panics() {
    let _ = game(
        Then(
            keyed(Scenter::build),
            keyed(|b| {
                b.provide::<Forged>();
                Forger
            }),
        ),
        Seed(1),
    );
}

#[test]
#[should_panic(expected = "rival declares test.scent but never provides it")]
fn a_contract_declared_but_never_provided_panics() {
    let _ = game(keyed(|_| Rival), Seed(1));
}

#[derive(Debug)]
struct Squatter;

impl Module for Squatter {
    const NAME: &'static str = "squatter";
    inert!();
}

#[test]
#[should_panic(expected = "squatter provides test.scent without declaring it")]
fn a_contract_provided_without_declaring_it_panics() {
    let _ = game(
        keyed(|b| {
            b.provide::<Scent>();
            Squatter
        }),
        Seed(1),
    );
}

/// Provides `Scent` and reads `Musk`.
#[derive(Debug)]
struct Fox {
    musk: Option<Read<Musk>>,
}

impl Module for Fox {
    const NAME: &'static str = "fox";
    const PROVIDES: &'static [Provided] = &[provides::<Scent>()];
    inert!();
}

/// Provides `Musk` and reads `Scent`.
#[derive(Debug)]
struct Deer {
    scent: Option<Read<Scent>>,
}

impl Module for Deer {
    const NAME: &'static str = "deer";
    const PROVIDES: &'static [Provided] = &[provides::<Musk>()];
    inert!();
}

#[test]
fn a_contract_cycle_builds() {
    let game = game(
        Then(
            keyed(|b| {
                b.provide::<Scent>();
                Fox { musk: b.contract() }
            }),
            keyed(|b| {
                b.provide::<Musk>();
                Deer {
                    scent: b.contract(),
                }
            }),
        ),
        Seed(1),
    );
    let both = game.mechanics();
    assert!(both.0.musk.is_some());
    assert!(both.1.scent.is_some());
}

#[test]
fn a_reader_alone_reads_nothing_and_runs() {
    let game = game(keyed(Sniffer::build), Seed(1));
    assert!(game.mechanics().scent.is_none());
    let mut f = floor(game.ruleset(), FloorId(0), 5, 5);
    let still = f.spawn_actor(game.ruleset(), Pos { x: 2, y: 2 });
    let mut world = World::new(vec![f]);
    run(&game, &mut world, 3);
    assert_eq!(world.floor(FloorId(0)).pos(still), Some(Pos { x: 2, y: 2 }));
}

actionless!(First, "first");
actionless!(Second, "second");

/// Declares `First` then `Second`, and builds `Second` first.
struct Backwards;

impl Recipe for Backwards {
    type Mechanics = Both<First, Second>;

    fn declare(&self, declarations: &mut Declarations) {
        declarations.module::<First>();
        declarations.module::<Second>();
    }

    fn build(self, assembly: &mut Assembly<'_>) -> Self::Mechanics {
        let second = assembly.module(|_| Second);
        Both(assembly.module(|_| First), second)
    }
}

#[test]
#[should_panic(expected = "second built out of declared order")]
fn a_module_built_out_of_declared_order_panics() {
    let _ = game(Backwards, Seed(1));
}

/// Declares `First` then `Second`, and builds `First` only.
struct Stops;

impl Recipe for Stops {
    type Mechanics = First;

    fn declare(&self, declarations: &mut Declarations) {
        declarations.module::<First>();
        declarations.module::<Second>();
    }

    fn build(self, assembly: &mut Assembly<'_>) -> First {
        assembly.module(|_| First)
    }
}

#[test]
#[should_panic(expected = "second declared but never built")]
fn a_module_declared_but_never_built_panics() {
    let _ = game(Stops, Seed(1));
}

#[test]
#[should_panic(expected = "rival takes test.scent twice")]
fn a_contract_taken_twice_panics() {
    let _ = game(
        keyed(|b| {
            b.provide::<Scent>();
            b.provide::<Scent>();
            Rival
        }),
        Seed(1),
    );
}

#[derive(Debug)]
struct Silty;

impl Module for Silty {
    const NAME: &'static str = "silty";
    const PROVIDES: &'static [Provided] = &[provides_cells::<Silt>()];
    inert!();
}

#[test]
#[should_panic(expected = "silty takes test.silt twice")]
fn a_cell_contract_taken_twice_panics() {
    let _ = game(
        keyed(|b| {
            b.provide_cells::<Silt>();
            b.provide_cells::<Silt>();
            Silty
        }),
        Seed(1),
    );
}

#[test]
#[should_panic(expected = "silty declares test.silt as cells, not a component")]
fn cells_taken_as_a_component_panic() {
    let _ = game(
        keyed(|b| {
            b.provide::<Silt>();
            Silty
        }),
        Seed(1),
    );
}

#[derive(Debug)]
struct Muddy;

impl Module for Muddy {
    const NAME: &'static str = "muddy";
    const PROVIDES: &'static [Provided] = &[provides::<Silt>()];
    inert!();
}

#[test]
#[should_panic(expected = "muddy declares test.silt as a component, not cells")]
fn a_component_taken_as_cells_panics() {
    let _ = game(
        keyed(|b| {
            b.provide_cells::<Silt>();
            Muddy
        }),
        Seed(1),
    );
}
