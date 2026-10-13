use core::fmt;
use core::marker::PhantomData;

use crate::build::{Assembly, Builder, Declarations};
use crate::module::{Mechanics, Module, Visit};

/// What builds the mechanics of a game: declared first, so a module may read
/// a contract whatever its place relative to the provider. A request is
/// different: its server must build before its asker.
pub trait Recipe {
    type Mechanics: Mechanics;
    fn declare(&self, declarations: &mut Declarations);
    fn build(self, assembly: &mut Assembly<'_>) -> Self::Mechanics;
}

/// Mechanics without keys build as they are.
impl<T: Mechanics> Recipe for T {
    type Mechanics = T;

    fn declare(&self, declarations: &mut Declarations) {
        self.each(&mut Declare(declarations));
    }

    fn build(self, assembly: &mut Assembly<'_>) -> T {
        self.each(&mut Keyless(assembly));
        self
    }
}

struct Declare<'a>(&'a mut Declarations);

impl Visit for Declare<'_> {
    fn module<M: Module>(&mut self, _: &M) {
        self.0.module::<M>();
    }
}

struct Keyless<'a, 'b>(&'a mut Assembly<'b>);

impl Visit for Keyless<'_, '_> {
    fn module<M: Module>(&mut self, _: &M) {
        self.0.assemble::<M, ()>(|_| ());
    }
}

/// A module built from its keys.
#[must_use]
pub fn keyed<M: Module, F: FnOnce(&mut Builder<'_>) -> M>(build: F) -> Keyed<M, F> {
    Keyed {
        build,
        module: PhantomData,
    }
}

pub struct Keyed<M, F> {
    build: F,
    module: PhantomData<fn() -> M>,
}

impl<M: Module, F> fmt::Debug for Keyed<M, F> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_tuple("Keyed").field(&M::NAME).finish()
    }
}

impl<M: Module, F: FnOnce(&mut Builder<'_>) -> M> Recipe for Keyed<M, F> {
    type Mechanics = M;

    fn declare(&self, declarations: &mut Declarations) {
        declarations.module::<M>();
    }

    fn build(self, assembly: &mut Assembly<'_>) -> M {
        assembly.module(self.build)
    }
}

/// Two recipes, built in order.
#[derive(Debug)]
pub struct Then<A, B>(pub A, pub B);

impl<A: Recipe, B: Recipe> Recipe for Then<A, B> {
    type Mechanics = Both<A::Mechanics, B::Mechanics>;

    fn declare(&self, declarations: &mut Declarations) {
        self.0.declare(declarations);
        self.1.declare(declarations);
    }

    fn build(self, assembly: &mut Assembly<'_>) -> Self::Mechanics {
        let first = self.0.build(assembly);
        Both(first, self.1.build(assembly))
    }
}

/// Two mechanics, visited in order.
#[derive(Debug)]
pub struct Both<A, B>(pub A, pub B);

impl<A: Mechanics, B: Mechanics> Mechanics for Both<A, B> {
    fn each<V: Visit>(&self, v: &mut V) {
        self.0.each(v);
        self.1.each(v);
    }
}
