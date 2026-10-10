use alloc::boxed::Box;
use alloc::vec::Vec;
use core::fmt;
use core::marker::PhantomData;

use crate::codec::Component;
use crate::column::{Column, ErasedColumn};

#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) struct ComponentId(pub(crate) u32);

#[derive(Debug)]
pub(crate) struct ComponentInfo {
    pub(crate) name: &'static str,
    pub(crate) new_column: fn() -> Box<dyn ErasedColumn>,
}

/// A typed name for one registered component. `fn() -> T` keeps the key
/// `Send`, `Sync` and `Copy` whatever `T` is.
pub struct ComponentKey<T> {
    pub(crate) id: ComponentId,
    marker: PhantomData<fn() -> T>,
}

impl<T> Clone for ComponentKey<T> {
    fn clone(&self) -> Self {
        *self
    }
}

impl<T> Copy for ComponentKey<T> {}

impl<T> PartialEq for ComponentKey<T> {
    fn eq(&self, other: &Self) -> bool {
        self.id == other.id
    }
}

impl<T> Eq for ComponentKey<T> {}

impl<T> fmt::Debug for ComponentKey<T> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_tuple("ComponentKey").field(&self.id.0).finish()
    }
}

#[derive(Debug, Default)]
pub struct SchemaBuilder {
    components: Vec<ComponentInfo>,
}

impl SchemaBuilder {
    /// One type may be registered under two names; each gets its own key.
    ///
    /// # Panics
    /// When `name` is empty, longer than `u16::MAX` bytes, or already
    /// registered.
    pub fn register<T: Component>(&mut self, name: &'static str) -> ComponentKey<T> {
        assert!(!name.is_empty(), "component name must not be empty");
        assert!(
            u16::try_from(name.len()).is_ok(),
            "component name longer than u16::MAX bytes"
        );
        assert!(
            self.components.iter().all(|info| info.name != name),
            "component name registered twice: {name}"
        );
        let id =
            ComponentId(u32::try_from(self.components.len()).expect("fewer than 2^32 components"));
        self.components.push(ComponentInfo {
            name,
            new_column: new_column::<T>,
        });
        ComponentKey {
            id,
            marker: PhantomData,
        }
    }

    #[must_use]
    pub fn build(self) -> Schema {
        Schema {
            components: self.components,
        }
    }
}

/// The ordered list of registered components, shared by every floor of a world.
#[derive(Debug)]
pub struct Schema {
    pub(crate) components: Vec<ComponentInfo>,
}

fn new_column<T: Component>() -> Box<dyn ErasedColumn> {
    Box::new(Column::<T>::new())
}
