use alloc::boxed::Box;
use core::any::{Any, TypeId};
use core::fmt;
use core::marker::PhantomData;

use korr_ecs::{Component, SchemaBuilder, checksum};

/// A component that one module provides and any module may read, under one
/// world-wide name.
pub trait Contract: Component {
    const NAME: &'static str;
}

/// A cell column that one module provides and any module may read, under
/// one world-wide name.
pub trait CellContract: 'static {
    const NAME: &'static str;
}

/// One contract a module declares in `Module::PROVIDES`.
pub struct Provided {
    pub(super) name: &'static str,
    pub(super) ty: TypeId,
    pub(super) kind: Kind,
}

/// A contract's write key, then its read key.
type Keys = (Box<dyn Any>, Box<dyn Any>);

pub(super) enum Kind {
    Component(fn(&mut SchemaBuilder) -> Keys),
    Cells,
}

impl fmt::Debug for Provided {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_tuple("Provided").field(&self.name).finish()
    }
}

#[must_use]
pub const fn provides<C: Contract>() -> Provided {
    Provided {
        name: C::NAME,
        ty: TypeId::of::<C>(),
        kind: Kind::Component(register::<C>),
    }
}

#[must_use]
pub const fn provides_cells<C: CellContract>() -> Provided {
    Provided {
        name: C::NAME,
        ty: TypeId::of::<C>(),
        kind: Kind::Cells,
    }
}

fn register<C: Contract>(schema: &mut SchemaBuilder) -> Keys {
    let own = schema.register::<C>(C::NAME);
    let read = own.read();
    (Box::new(own), Box::new(read))
}

/// A cell column's place in its ruleset; `Columns` sets the order.
#[derive(Debug, Clone, Copy)]
pub(crate) struct ColumnIdx(u16);

impl ColumnIdx {
    /// # Panics
    /// When `at` does not fit `u16`.
    pub(crate) fn new(at: usize) -> Self {
        Self(u16::try_from(at).expect("cell columns fit u16"))
    }

    #[inline]
    pub(crate) const fn index(self) -> usize {
        self.0 as usize
    }

    pub(crate) const fn to_le_bytes(self) -> [u8; 2] {
        self.0.to_le_bytes()
    }
}

/// A hash of a cell column's name: the ruleset's fingerprint does not exist
/// yet when a `ReadCells` is made, so the key carries its column's name.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct ColumnName(u64);

impl ColumnName {
    pub(crate) fn of(name: &str) -> Self {
        Self(checksum(name.as_bytes()))
    }
}

pub(crate) const FOREIGN_CELLS: &str = "cell column key from another ruleset";

/// The read side of a cell column, for `Senses::cells`.
#[derive(Debug, Clone, Copy)]
pub struct ReadCells {
    pub(crate) column: ColumnIdx,
    pub(crate) name: ColumnName,
}

impl ReadCells {
    /// Whether the column at this key's place in `names` is its own.
    pub(crate) fn is_in(self, names: &[ColumnName]) -> bool {
        names.get(self.column.index()) == Some(&self.name)
    }
}

/// A request that one module serves on its own cell column: it checks a
/// cell in the asker's prepare and applies the request in its commit.
pub trait Request: 'static {
    const NAME: &'static str;
}

/// The request a module declares in `Module::SERVES`, with the two halves
/// that serve it: a server cannot declare one without them.
#[derive(Debug, Clone, Copy)]
pub struct Served {
    pub(super) name: &'static str,
    pub(super) ty: TypeId,
    pub(super) service: Service,
}

/// The two halves that serve a request.
#[derive(Debug, Clone, Copy)]
pub(crate) struct Service {
    /// The reply at a cell holding a value, in the asker's prepare; `None` refuses.
    pub(crate) check: fn(u8) -> Option<u8>,
    /// The cell's value once the request is applied, in the asker's commit.
    pub(crate) apply: fn(u8) -> u8,
}

/// ```
/// # use korr_core::mechanic::{Request, Served, serves};
/// struct Graze;
/// impl Request for Graze {
///     const NAME: &'static str = "graze";
/// }
/// const SERVES: Option<Served> = Some(serves::<Graze>(|v| Some(v), |_| 0));
/// ```
#[must_use]
pub const fn serves<C: Request>(check: fn(u8) -> Option<u8>, apply: fn(u8) -> u8) -> Served {
    Served {
        name: C::NAME,
        ty: TypeId::of::<C>(),
        service: Service { check, apply },
    }
}

/// The right to send `C` to the module that serves it.
pub struct Ask<C> {
    pub(crate) service: Service,
    pub(crate) column: ColumnIdx,
    pub(crate) kind: PhantomData<fn() -> C>,
}

impl<C> Clone for Ask<C> {
    fn clone(&self) -> Self {
        *self
    }
}

impl<C> Copy for Ask<C> {}

impl<C> fmt::Debug for Ask<C> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_tuple("Ask").field(&self.column).finish()
    }
}
