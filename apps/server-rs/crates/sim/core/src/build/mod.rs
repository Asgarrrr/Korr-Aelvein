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
    Ask, CellContract, Contract, Provided, ReadCells, Request, Served, provides, provides_cells,
    serves,
};
pub use recipe::{Both, Keyed, Recipe, Then, keyed};

use contract::Kind;
pub(crate) use contract::{ColumnIdx, ColumnName, FOREIGN_ASK, FOREIGN_CELLS};

/// A registered contract: its write key, or the binding of its cell column,
/// waits for its provider's build.
struct Registration {
    ty: TypeId,
    held: Held,
}

enum Held {
    Component {
        own: Option<Box<dyn Any>>,
        read: Box<dyn Any>,
    },
    Cells {
        own: Option<ReadCells>,
        read: ReadCells,
    },
}

impl Held {
    fn taken(&self) -> bool {
        match self {
            Self::Component { own, .. } => own.is_none(),
            Self::Cells { own, .. } => own.is_none(),
        }
    }
}

/// Every module of a recipe in build order, the contracts they provide and
/// the requests they serve.
#[derive(Debug)]
pub struct Declarations {
    modules: Vec<&'static str>,
    contracts: Vec<(&'static str, &'static Provided)>,
    requests: Vec<Server>,
}

/// A declared request and the module that serves it.
#[derive(Debug, Clone, Copy)]
struct Server {
    module: &'static str,
    served: Served,
    /// The module's place in build order.
    ordinal: usize,
}

impl Declarations {
    /// # Panics
    /// When `M` provides a contract another module provides, names a
    /// contract another module binds to another type, or serves a request
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
            for server in &self.requests {
                assert!(
                    server.served.ty != served.ty,
                    "request {} served by {} and {}",
                    served.name,
                    server.module,
                    M::NAME
                );
            }
            self.requests.push(Server {
                module: M::NAME,
                served,
                ordinal: self.modules.len(),
            });
        }
        self.modules.push(M::NAME);
    }
}

/// Builds every module in declared order, each through its own `Builder`.
pub struct Assembly<'a> {
    schema: &'a mut SchemaBuilder,
    declared: &'a [&'static str],
    requests: &'a [Server],
    registrations: &'a mut [Registration],
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
    /// contract it declares, or serves a request without a cell column.
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
            registrations: self.registrations,
            requests: self.requests,
            names: &mut self.columns.names,
            owners: &self.columns.owners,
            column: &mut column,
            module: M::NAME,
            provides: M::PROVIDES,
        });
        for provided in M::PROVIDES {
            assert!(
                registration(self.registrations, provided.ty).is_some_and(|r| r.held.taken()),
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

fn registration(registrations: &[Registration], ty: TypeId) -> Option<&Registration> {
    registrations.iter().find(|r| r.ty == ty)
}

/// The cell columns of a recipe: contract columns in provider visit order,
/// then private columns in build order.
#[derive(Debug, Default)]
pub(crate) struct Columns {
    pub(crate) names: Vec<String>,
    /// The column each module binds, in visit order.
    pub(crate) owners: Vec<Option<ColumnIdx>>,
}

/// What one module's build may reach: its own components and cell column,
/// the contracts and the requests.
pub struct Builder<'a> {
    schema: &'a mut SchemaBuilder,
    registrations: &'a mut [Registration],
    requests: &'a [Server],
    names: &'a mut Vec<String>,
    /// The column each built module binds, in visit order.
    owners: &'a [Option<ColumnIdx>],
    column: &'a mut Option<ColumnIdx>,
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
    /// When `<module>.<name>` is longer than `u16::MAX` bytes or already
    /// registered, or the schema already holds 2^32 components.
    pub fn own<T: Component>(&mut self, name: &str) -> Own<T> {
        self.schema.register(&format!("{}.{name}", self.module))
    }

    /// # Panics
    /// When the module does not declare `C` as a component in `PROVIDES`, or
    /// takes it twice.
    pub fn provide<C: Contract>(&mut self) -> Own<C> {
        let module = self.module;
        let Held::Component { own, .. } = self.held::<C>(C::NAME) else {
            panic!("{module} declares {} as cells, not a component", C::NAME);
        };
        *own.take()
            .unwrap_or_else(|| panic!("{module} takes {} twice", C::NAME))
            .downcast()
            .expect("a registration holds the key of its type")
    }

    /// `None` when no module of the recipe provides `C`.
    #[must_use]
    pub fn contract<C: Contract>(&self) -> Option<Read<C>> {
        registration(self.registrations, TypeId::of::<C>()).and_then(|r| match &r.held {
            Held::Component { read, .. } => read.downcast_ref().copied(),
            Held::Cells { .. } => None,
        })
    }

    /// Binds the module's own cell column, named `<module>.<name>`: no module
    /// holds a write key to it, its tick is its only writer.
    ///
    /// # Panics
    /// When the module already binds a cell column.
    pub fn cells(&mut self, name: &str) {
        self.bind(ColumnIdx::new(self.names.len()));
        self.names.push(format!("{}.{name}", self.module));
    }

    /// Binds the cell column of `C` as the module's own.
    ///
    /// # Panics
    /// When the module does not declare `C` as cells in `PROVIDES`, takes it
    /// twice, or already binds a cell column.
    pub fn provide_cells<C: CellContract>(&mut self) -> ReadCells {
        let module = self.module;
        let Held::Cells { own, .. } = self.held::<C>(C::NAME) else {
            panic!("{module} declares {} as a component, not cells", C::NAME);
        };
        let cells = own
            .take()
            .unwrap_or_else(|| panic!("{module} takes {} twice", C::NAME));
        self.bind(cells.column);
        cells
    }

    /// `None` when no module of the recipe provides `C`.
    #[must_use]
    pub fn contract_cells<C: CellContract>(&self) -> Option<ReadCells> {
        registration(self.registrations, TypeId::of::<C>()).and_then(|r| match &r.held {
            Held::Cells { read, .. } => Some(*read),
            Held::Component { .. } => None,
        })
    }

    /// `None` when no module of the recipe serves `C`.
    ///
    /// # Panics
    /// When this module serves `C`, or the server of `C` builds after it.
    #[must_use]
    pub fn request<C: Request>(&self) -> Option<Ask<C>> {
        let ty = TypeId::of::<C>();
        let server = self.requests.iter().find(|s| s.served.ty == ty)?;
        let name = server.served.name;
        // Built modules each push one owner, so this module's ordinal is their count.
        assert!(
            server.ordinal != self.owners.len(),
            "{} asks its own request {name}",
            self.module
        );
        let column = self
            .owners
            .get(server.ordinal)
            .unwrap_or_else(|| panic!("{} asks {name} before its server builds", self.module));
        let column = column.expect("a module that serves a request binds a cell column");
        Some(Ask {
            service: server.served.service,
            cells: ReadCells {
                column,
                name: ColumnName::of(&self.names[column.index()]),
            },
            kind: PhantomData,
        })
    }

    fn held<C: 'static>(&mut self, name: &str) -> &mut Held {
        let ty = TypeId::of::<C>();
        assert!(
            self.provides.iter().any(|p| p.ty == ty),
            "{} provides {name} without declaring it",
            self.module
        );
        self.registrations
            .iter_mut()
            .find(|r| r.ty == ty)
            .map(|r| &mut r.held)
            .expect("a declared contract is registered")
    }

    fn bind(&mut self, column: ColumnIdx) {
        assert!(
            self.column.is_none(),
            "{} owns two cell columns",
            self.module
        );
        *self.column = Some(column);
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
        requests: Vec::new(),
    };
    recipe.declare(&mut declarations);
    let mut columns = Columns::default();
    let mut registrations: Vec<Registration> = declarations
        .contracts
        .iter()
        .map(|(_, provided)| {
            let held = match provided.kind {
                Kind::Component(register) => {
                    let (own, read) = register(schema);
                    Held::Component {
                        own: Some(own),
                        read,
                    }
                }
                Kind::Cells => {
                    let column = ColumnIdx::new(columns.names.len());
                    columns.names.push(provided.name.to_string());
                    let read = ReadCells {
                        column,
                        name: ColumnName::of(provided.name),
                    };
                    Held::Cells {
                        own: Some(read),
                        read,
                    }
                }
            };
            Registration {
                ty: provided.ty,
                held,
            }
        })
        .collect();
    let mut assembly = Assembly {
        schema,
        declared: &declarations.modules,
        requests: &declarations.requests,
        registrations: &mut registrations,
        columns: &mut columns,
        next: 0,
    };
    let mechanics = recipe.build(&mut assembly);
    if let Some(name) = declarations.modules.get(assembly.next) {
        panic!("{name} declared but never built");
    }
    (mechanics, columns)
}
