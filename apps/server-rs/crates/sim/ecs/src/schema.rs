use alloc::boxed::Box;
use alloc::vec::Vec;
use core::fmt;
use core::marker::PhantomData;

use crate::codec::{Component, FNV_OFFSET, absorb};
use crate::column::{Column, ErasedColumn};

#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) struct ComponentId(pub(crate) u32);

#[derive(Debug)]
pub(crate) struct ComponentInfo {
    pub(crate) name: &'static str,
    pub(crate) prefix: u64,
    pub(crate) new_column: fn() -> Box<dyn ErasedColumn>,
}

/// The read half of a component key. `fn() -> T` keeps the key `Send`,
/// `Sync` and `Copy` whatever `T` is. `prefix` hashes the ordered names up to
/// this one, so a store of another schema rejects the key.
pub struct Read<T> {
    pub(crate) id: ComponentId,
    pub(crate) prefix: u64,
    marker: PhantomData<fn() -> T>,
}

impl<T> Clone for Read<T> {
    fn clone(&self) -> Self {
        *self
    }
}

impl<T> Copy for Read<T> {}

impl<T> PartialEq for Read<T> {
    fn eq(&self, other: &Self) -> bool {
        self.id == other.id && self.prefix == other.prefix
    }
}

impl<T> Eq for Read<T> {}

impl<T> fmt::Debug for Read<T> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("Read")
            .field("id", &self.id.0)
            .field("prefix", &self.prefix)
            .finish()
    }
}

/// The write half of a component key, minted once by `register`. It is not
/// `Clone`: whoever registered the component is the only writer.
///
/// ```
/// # use korr_ecs::{Component, FloorId, ImageError, Reader, SchemaBuilder, Store, Writer};
/// # #[derive(Clone, Debug, PartialEq)]
/// # struct Satiety(u8);
/// # impl Component for Satiety {
/// #     fn write(&self, w: &mut Writer) { w.write_u8(self.0); }
/// #     fn read(r: &mut Reader<'_>) -> Result<Self, ImageError> { r.read_u8().map(Self) }
/// # }
/// let mut builder = SchemaBuilder::default();
/// let own = builder.register::<Satiety>("satiety");
/// let mut store = Store::new(&builder.build(), FloorId(0));
/// let h = store.spawn();
/// store.insert(&own, h, Satiety(1));
/// assert_eq!(store.get(own.read(), h), Some(&Satiety(1)));
/// ```
///
/// ```compile_fail
/// # use korr_ecs::{Component, ImageError, Reader, SchemaBuilder, Writer};
/// # #[derive(Clone)]
/// # struct Satiety(u8);
/// # impl Component for Satiety {
/// #     fn write(&self, w: &mut Writer) { w.write_u8(self.0); }
/// #     fn read(r: &mut Reader<'_>) -> Result<Self, ImageError> { r.read_u8().map(Self) }
/// # }
/// let own = SchemaBuilder::default().register::<Satiety>("satiety");
/// let _copy = own.clone();
/// ```
///
/// ```
/// # use korr_ecs::{Component, FloorId, ImageError, Reader, SchemaBuilder, Store, Writer};
/// # struct Dread(u8);
/// # impl Component for Dread {
/// #     fn write(&self, w: &mut Writer) { w.write_u8(self.0); }
/// #     fn read(r: &mut Reader<'_>) -> Result<Self, ImageError> { r.read_u8().map(Self) }
/// # }
/// let mut builder = SchemaBuilder::default();
/// let own = builder.register::<Dread>("dread");
/// let mut store = Store::new(&builder.build(), FloorId(0));
/// let h = store.spawn();
/// store.insert(&own, h, Dread(1));
/// if let Some(dread) = store.get_mut(&own, h) {
///     dread.0 += 1;
/// }
/// ```
///
/// ```compile_fail
/// # use korr_ecs::{Component, FloorId, ImageError, Reader, SchemaBuilder, Store, Writer};
/// # struct Dread(u8);
/// # impl Component for Dread {
/// #     fn write(&self, w: &mut Writer) { w.write_u8(self.0); }
/// #     fn read(r: &mut Reader<'_>) -> Result<Self, ImageError> { r.read_u8().map(Self) }
/// # }
/// let mut builder = SchemaBuilder::default();
/// let own = builder.register::<Dread>("dread");
/// let mut store = Store::new(&builder.build(), FloorId(0));
/// let h = store.spawn();
/// let _dread = store.get_mut(own.read(), h);
/// ```
pub struct Own<T> {
    read: Read<T>,
}

impl<T> Own<T> {
    #[must_use]
    #[inline]
    pub fn read(&self) -> Read<T> {
        self.read
    }
}

impl<T> fmt::Debug for Own<T> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_tuple("Own").field(&self.read).finish()
    }
}

#[derive(Debug)]
pub struct SchemaBuilder {
    components: Vec<ComponentInfo>,
    prefix: u64,
}

impl Default for SchemaBuilder {
    fn default() -> Self {
        Self {
            components: Vec::new(),
            prefix: FNV_OFFSET,
        }
    }
}

impl SchemaBuilder {
    /// One type may be registered under two names; each gets its own key.
    ///
    /// # Panics
    /// When `name` is empty, longer than `u16::MAX` bytes, or already
    /// registered.
    pub fn register<T: Component>(&mut self, name: &'static str) -> Own<T> {
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
        let len = u16::try_from(name.len()).expect("a component name fits in u16 bytes");
        self.prefix = absorb(absorb(self.prefix, &len.to_le_bytes()), name.as_bytes());
        self.components.push(ComponentInfo {
            name,
            prefix: self.prefix,
            new_column: new_column::<T>,
        });
        Own {
            read: Read {
                id,
                prefix: self.prefix,
                marker: PhantomData,
            },
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

impl Schema {
    /// A hash of the ordered component names: equal for two schemas that
    /// register the same names in the same order.
    #[must_use]
    pub fn fingerprint(&self) -> u64 {
        self.components
            .last()
            .map_or(FNV_OFFSET, |info| info.prefix)
    }
}

fn new_column<T: Component>() -> Box<dyn ErasedColumn> {
    Box::new(Column::<T>::new())
}
