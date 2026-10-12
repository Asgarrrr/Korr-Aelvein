mod contract;
mod recipe;

use alloc::boxed::Box;
use alloc::format;
use alloc::string::{String, ToString};
use alloc::vec::Vec;
use core::any::{Any, TypeId};
use core::fmt;
use core::marker::PhantomData;

use korr_ecs::{Component, Own, Read, SchemaBuilder};

use crate::module::Module;

pub use contract::{
    Ask, CellContract, Command, Contract, Provided, ReadCells, Served, provides, provides_cells,
    serves,
};
pub use recipe::{Both, Keyed, Recipe, Then, keyed};

use contract::Kind;

/// A registered contract: its write key, or the binding of its cell column,
/// waits for its provider's build.
struct Slot {
    ty: TypeId,
    own: Option<Box<dyn Any>>,
    read: Box<dyn Any>,
}

/// Every module of a recipe in build order, the contracts they provide and
/// the commands they serve.
#[derive(Debug)]
pub struct Declarations {
    modules: Vec<&'static str>,
    contracts: Vec<(&'static str, &'static Provided)>,
    /// Each with its server's name and visit ordinal.
    commands: Vec<(&'static str, Served, u16)>,
}

impl Declarations {
    /// # Panics
    /// When `M` provides a contract another module provides, names a
    /// contract another module binds to another type, or serves a command
    /// another module serves.
    pub fn module<M: Module>(&mut self) {
        for provided in M::PROVIDES {
            for &(provider, other) in &self.contracts {
                assert!(
                    other.ty != provided.ty,
                    "contract {} provided by {provider} and {}",
                    provided.name,
                    M::NAME
                );
                assert!(
                    other.name != provided.name,
                    "contract {} bound to two types",
                    provided.name
                );
            }
            self.contracts.push((M::NAME, provided));
        }
        if let Some(served) = M::SERVES {
            for &(server, other, _) in &self.commands {
                assert!(
                    other.ty != served.ty,
                    "command {} served by {server} and {}",
                    served.name,
                    M::NAME
                );
            }
            let ordinal = u16::try_from(self.modules.len()).expect("a module table fits u16");
            self.commands.push((M::NAME, served, ordinal));
        }
        self.modules.push(M::NAME);
    }
}

/// Builds every module in declared order, each through its own `Builder`.
pub struct Assembly<'a> {
    schema: &'a mut SchemaBuilder,
    declared: &'a [&'static str],
    commands: &'a [(&'static str, Served, u16)],
    slots: &'a mut [Slot],
    columns: &'a mut Columns,
    next: usize,
}

impl fmt::Debug for Assembly<'_> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("Assembly")
            .field("declared", &self.declared)
            .field("next", &self.next)
            .finish_non_exhaustive()
    }
}

impl Assembly<'_> {
    /// # Panics
    /// When `M` is not the next declared module, does not provide every
    /// contract it declares, or serves a command without a cell column.
    pub fn module<M: Module>(&mut self, build: impl FnOnce(&mut Builder<'_>) -> M) -> M {
        self.assemble::<M, M>(build)
    }

    fn assemble<M: Module, T>(&mut self, build: impl FnOnce(&mut Builder<'_>) -> T) -> T {
        assert!(
            self.declared.get(self.next) == Some(&M::NAME),
            "{} built out of declared order",
            M::NAME
        );
        self.next += 1;
        let mut column = None;
        let module = build(&mut Builder {
            schema: self.schema,
            slots: self.slots,
            commands: self.commands,
            names: &mut self.columns.names,
            column: &mut column,
            module: M::NAME,
            provides: M::PROVIDES,
        });
        for provided in M::PROVIDES {
            assert!(
                slot(self.slots, provided.ty).is_some_and(|s| s.own.is_none()),
                "{} declares {} but never provides it",
                M::NAME,
                provided.name
            );
        }
        if let Some(served) = M::SERVES {
            assert!(
                column.is_some(),
                "{} serves {} without a cell column",
                M::NAME,
                served.name
            );
        }
        self.columns.owners.push(column);
        module
    }
}

fn slot(slots: &[Slot], ty: TypeId) -> Option<&Slot> {
    slots.iter().find(|s| s.ty == ty)
}

/// The cell columns of a recipe: contract columns in provider visit order,
/// then private columns in build order.
#[derive(Debug, Default)]
pub(crate) struct Columns {
    pub(crate) names: Vec<String>,
    /// The column each module binds, in visit order.
    pub(crate) owners: Vec<Option<u16>>,
}

/// What one module's build may reach: its own components and cell column,
/// the contracts and the commands.
pub struct Builder<'a> {
    schema: &'a mut SchemaBuilder,
    slots: &'a mut [Slot],
    commands: &'a [(&'static str, Served, u16)],
    names: &'a mut Vec<String>,
    column: &'a mut Option<u16>,
    module: &'static str,
    provides: &'static [Provided],
}

impl fmt::Debug for Builder<'_> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("Builder")
            .field("module", &self.module)
            .finish_non_exhaustive()
    }
}

impl Builder<'_> {
    /// A component named `<module>.<name>`, private to the module.
    ///
    /// # Panics
    /// When the module already registered `name`.
    pub fn own<T: Component>(&mut self, name: &str) -> Own<T> {
        self.schema.register(&format!("{}.{name}", self.module))
    }

    /// # Panics
    /// When the module does not declare `C` in `PROVIDES`, or takes it twice.
    pub fn provide<C: Contract>(&mut self) -> Own<C> {
        *self
            .take::<C>(C::NAME)
            .downcast()
            .expect("a slot holds the key of its type")
    }

    /// `None` when no module of the recipe provides `C`.
    #[must_use]
    pub fn contract<C: Contract>(&self) -> Option<Read<C>> {
        slot(self.slots, TypeId::of::<C>()).and_then(|s| s.read.downcast_ref().copied())
    }

    /// Binds the module's own cell column, named `<module>.<name>`: no module
    /// holds a write key to it, its tick is its only writer.
    ///
    /// # Panics
    /// When the module already binds a cell column.
    pub fn cells(&mut self, name: &str) {
        let slot = u16::try_from(self.names.len()).expect("cell columns fit u16");
        self.bind(slot);
        self.names.push(format!("{}.{name}", self.module));
    }

    /// Binds the cell column of `C` as the module's own.
    ///
    /// # Panics
    /// When the module does not declare `C` in `PROVIDES`, takes it twice,
    /// or already binds a cell column.
    pub fn provide_cells<C: CellContract>(&mut self) {
        let cells: Box<ReadCells> = self
            .take::<C>(C::NAME)
            .downcast()
            .expect("a cell slot holds its column");
        self.bind(cells.slot);
    }

    /// `None` when no module of the recipe provides `C`.
    #[must_use]
    pub fn contract_cells<C: CellContract>(&self) -> Option<ReadCells> {
        slot(self.slots, TypeId::of::<C>()).and_then(|s| s.read.downcast_ref().copied())
    }

    /// `None` when no module of the recipe serves `C`.
    #[must_use]
    pub fn command<C: Command>(&self) -> Option<Ask<C>> {
        let ty = TypeId::of::<C>();
        self.commands
            .iter()
            .find(|(_, served, _)| served.ty == ty)
            .map(|&(.., module)| Ask {
                module,
                kind: PhantomData,
            })
    }

    fn take<C: 'static>(&mut self, name: &str) -> Box<dyn Any> {
        let ty = TypeId::of::<C>();
        assert!(
            self.provides.iter().any(|p| p.ty == ty),
            "{} provides {name} without declaring it",
            self.module
        );
        self.slots
            .iter_mut()
            .find(|s| s.ty == ty)
            .and_then(|s| s.own.take())
            .unwrap_or_else(|| panic!("{} provides {name} twice", self.module))
    }

    fn bind(&mut self, slot: u16) {
        assert!(
            self.column.is_none(),
            "{} owns two cell columns",
            self.module
        );
        *self.column = Some(slot);
    }
}
/// The schema and cell columns of a recipe, and the mechanics it builds.
///
/// # Panics
/// When a declaration or a build breaks its rules, or the recipe builds
/// fewer modules than it declares.
pub(crate) fn assemble<R: Recipe>(
    recipe: R,
    schema: &mut SchemaBuilder,
) -> (R::Mechanics, Columns) {
    let mut declarations = Declarations {
        modules: Vec::new(),
        contracts: Vec::new(),
        commands: Vec::new(),
    };
    recipe.declare(&mut declarations);
    let mut columns = Columns::default();
    let mut slots: Vec<Slot> = declarations
        .contracts
        .iter()
        .map(|(_, provided)| {
            let (own, read) = match provided.kind {
                Kind::Component(register) => register(schema),
                Kind::Cells => {
                    let slot = u16::try_from(columns.names.len()).expect("cell columns fit u16");
                    columns.names.push(provided.name.to_string());
                    let cells = ReadCells { slot };
                    (
                        Box::new(cells) as Box<dyn Any>,
                        Box::new(cells) as Box<dyn Any>,
                    )
                }
            };
            Slot {
                ty: provided.ty,
                own: Some(own),
                read,
            }
        })
        .collect();
    let mut assembly = Assembly {
        schema,
        declared: &declarations.modules,
        commands: &declarations.commands,
        slots: &mut slots,
        columns: &mut columns,
        next: 0,
    };
    let mechanics = recipe.build(&mut assembly);
    if let Some(name) = declarations.modules.get(assembly.next) {
        panic!("{name} declared but never built");
    }
    (mechanics, columns)
}
