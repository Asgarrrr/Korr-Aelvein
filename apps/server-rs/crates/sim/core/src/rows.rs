use alloc::vec::Vec;

use korr_ecs::{Component, Own, Store};
use korr_random::ModuleKey;

use crate::life::{Cause, Harm};

/// The entity rows of one floor, for a module's bulk tick: a write needs
/// the write key, so a tick writes only the columns its module owns.
///
/// ```
/// # use core::convert::Infallible;
/// # use korr_core::host::{Floor, Game, Round, Seed, World, keyed};
/// # use korr_core::mechanic::{
/// #     Builder, CommitCtx, Component, ImageError, Module, Own, Pos, PrepCtx, Prepared,
/// #     Proposals, Reader, Rows, Senses, Target, Writer,
/// # };
/// # use korr_ecs::FloorId;
/// # use korr_grid::Shape;
/// # struct Fat(u8);
/// # impl Component for Fat {
/// #     const VERSION: u16 = 0;
/// #     fn write(&self, w: &mut Writer) { w.write_u8(self.0); }
/// #     fn read(r: &mut Reader<'_>) -> Result<Self, ImageError> { r.read_u8().map(Self) }
/// # }
/// # struct Lean(u8);
/// # impl Component for Lean {
/// #     const VERSION: u16 = 0;
/// #     fn write(&self, w: &mut Writer) { w.write_u8(self.0); }
/// #     fn read(r: &mut Reader<'_>) -> Result<Self, ImageError> { r.read_u8().map(Self) }
/// # }
/// struct Burn {
///     fat: Own<Fat>,
///     lean: Own<Lean>,
/// }
///
/// impl Module for Burn {
///     const NAME: &'static str = "burn";
/// #   type Action = Infallible;
/// #   type Plan = Infallible;
///     fn tick_rows(&self, rows: &mut Rows<'_>) {
///         rows.join(&self.fat, &self.lean, |fat: &mut Fat, lean: &mut Lean| {
///             fat.0 = fat.0.saturating_sub(1);
///             lean.0 = lean.0.saturating_add(1);
///             0
///         });
///     }
/// #   fn propose(&self, _: &Senses<'_>, _: &mut Proposals<'_, Infallible>) {}
/// #   fn prepare(&self, a: Infallible, _: Target, _: &PrepCtx<'_>) -> Prepared<Infallible, Infallible> {
/// #       match a {}
/// #   }
/// #   fn commit(&self, plan: Infallible, _: &mut CommitCtx<'_>) { match plan {} }
/// }
///
/// let burn = keyed(|b: &mut Builder<'_>| Burn {
///     fat: b.own("fat"),
///     lean: b.own("lean"),
/// });
/// let game = Game::new(burn, Seed(1));
/// let shape = Shape::new(5, 5).expect("5x5 fits the bounds");
/// let mut floor = Floor::new(game.ruleset(), FloorId(0), shape);
/// let h = floor.spawn_thing(Pos { x: 2, y: 2 });
/// floor.insert(&game.mechanics().fat, h, Fat(9));
/// floor.insert(&game.mechanics().lean, h, Lean(0));
/// let mut world = World::new(vec![floor]);
/// game.run_round(&mut world);
/// assert_eq!(world.floor(FloorId(0)).round(), Round(1));
/// ```
///
/// ```compile_fail
/// # use core::convert::Infallible;
/// # use korr_core::host::{Floor, Game, Round, Seed, World, keyed};
/// # use korr_core::mechanic::{
/// #     Builder, CommitCtx, Component, ImageError, Module, Own, Pos, PrepCtx, Prepared,
/// #     Proposals, Reader, Rows, Senses, Target, Writer,
/// # };
/// # use korr_ecs::FloorId;
/// # use korr_grid::Shape;
/// # struct Fat(u8);
/// # impl Component for Fat {
/// #     const VERSION: u16 = 0;
/// #     fn write(&self, w: &mut Writer) { w.write_u8(self.0); }
/// #     fn read(r: &mut Reader<'_>) -> Result<Self, ImageError> { r.read_u8().map(Self) }
/// # }
/// # struct Lean(u8);
/// # impl Component for Lean {
/// #     const VERSION: u16 = 0;
/// #     fn write(&self, w: &mut Writer) { w.write_u8(self.0); }
/// #     fn read(r: &mut Reader<'_>) -> Result<Self, ImageError> { r.read_u8().map(Self) }
/// # }
/// struct Burn {
///     fat: Own<Fat>,
///     lean: Own<Lean>,
/// }
///
/// impl Module for Burn {
///     const NAME: &'static str = "burn";
/// #   type Action = Infallible;
/// #   type Plan = Infallible;
///     fn tick_rows(&self, rows: &mut Rows<'_>) {
///         rows.join(&self.fat.read(), &self.lean, |fat: &mut Fat, lean: &mut Lean| {
///             fat.0 = fat.0.saturating_sub(1);
///             lean.0 = lean.0.saturating_add(1);
///             0
///         });
///     }
/// #   fn propose(&self, _: &Senses<'_>, _: &mut Proposals<'_, Infallible>) {}
/// #   fn prepare(&self, a: Infallible, _: Target, _: &PrepCtx<'_>) -> Prepared<Infallible, Infallible> {
/// #       match a {}
/// #   }
/// #   fn commit(&self, plan: Infallible, _: &mut CommitCtx<'_>) { match plan {} }
/// }
///
/// let burn = keyed(|b: &mut Builder<'_>| Burn {
///     fat: b.own("fat"),
///     lean: b.own("lean"),
/// });
/// let game = Game::new(burn, Seed(1));
/// let shape = Shape::new(5, 5).expect("5x5 fits the bounds");
/// let mut floor = Floor::new(game.ruleset(), FloorId(0), shape);
/// let h = floor.spawn_thing(Pos { x: 2, y: 2 });
/// floor.insert(&game.mechanics().fat, h, Fat(9));
/// floor.insert(&game.mechanics().lean, h, Lean(0));
/// let mut world = World::new(vec![floor]);
/// game.run_round(&mut world);
/// assert_eq!(world.floor(FloorId(0)).round(), Round(1));
/// ```
#[derive(Debug)]
pub struct Rows<'a> {
    store: &'a mut Store,
    harms: &'a mut Vec<Harm>,
    module: ModuleKey,
}

impl<'a> Rows<'a> {
    pub(crate) fn new(store: &'a mut Store, harms: &'a mut Vec<Harm>, module: ModuleKey) -> Self {
        Self {
            store,
            harms,
            module,
        }
    }
}

impl Rows<'_> {
    /// Calls `f` on every row that holds both `a` and `b`, in the dense order
    /// of `a`. A non-zero return harms the row's entity by that amount, as
    /// the module's doing.
    ///
    /// # Panics
    /// When `a` and `b` are the same key, or a key comes from another schema.
    #[inline]
    pub fn join<A: Component, B: Component>(
        &mut self,
        a: &Own<A>,
        b: &Own<B>,
        mut f: impl FnMut(&mut A, &mut B) -> u16,
    ) {
        let mut harmed = Vec::new();
        self.store.join_mut(a, b, |h, a, b| {
            let amount = f(a, b);
            if amount > 0 {
                harmed.push((h, amount));
            }
        });
        let cause = Cause::Mechanic(self.module);
        for (h, amount) in harmed {
            let id = self.store.id(h).expect("a joined row is alive");
            self.harms.push((id, cause, amount));
        }
    }
}
