use alloc::boxed::Box;
use alloc::vec::Vec;
use core::any::Any;
use core::fmt::{self, Debug};

use crate::codec::Component;
use crate::column::{Column, ErasedColumn, FOREIGN_KEY, typed, typed_mut};
use crate::entities::Entities;
use crate::id::{EntityId, FloorId, Handle};
use crate::schema::{AnyRead, ComponentId, Own, Read, Schema};

/// The entities and component columns of one floor.
pub struct Store {
    pub(crate) entities: Entities,
    pub(crate) columns: Vec<Box<dyn ErasedColumn>>,
    pub(crate) prefixes: Vec<u64>,
    pub(crate) fingerprint: u64,
}

impl Store {
    #[must_use]
    pub fn new(schema: &Schema, floor: FloorId) -> Self {
        Self {
            entities: Entities::new(floor),
            columns: schema
                .components
                .iter()
                .map(|info| (info.new_column)())
                .collect(),
            prefixes: schema.components.iter().map(|info| info.prefix).collect(),
            fingerprint: schema.fingerprint(),
        }
    }

    #[must_use]
    #[inline]
    pub fn floor(&self) -> FloorId {
        self.entities.floor()
    }

    #[must_use]
    #[inline]
    pub fn next_counter(&self) -> u64 {
        self.entities.next_counter()
    }

    /// The new entity's id is never reused, even when its slot is.
    pub fn spawn(&mut self) -> Handle {
        self.entities.spawn()
    }

    /// # Panics
    /// When `h` is dead.
    pub fn despawn(&mut self, h: Handle) {
        self.entities.free(h);
        for column in &mut self.columns {
            column.clear_slot(h.slot);
        }
    }

    #[must_use]
    #[inline]
    pub fn is_alive(&self, h: Handle) -> bool {
        self.entities.is_alive(h)
    }

    #[must_use]
    #[inline]
    pub fn id(&self, h: Handle) -> Option<EntityId> {
        self.entities.id(h)
    }

    /// The live entity named `id` on this floor.
    #[must_use]
    #[inline]
    pub fn handle_of(&self, id: EntityId) -> Option<Handle> {
        self.entities.handle_of(id)
    }

    /// Every live entity, in ascending slot.
    pub fn handles(&self) -> impl Iterator<Item = Handle> + '_ {
        self.entities.handles()
    }

    #[must_use]
    #[inline]
    pub fn len(&self) -> usize {
        self.entities.len()
    }

    #[must_use]
    #[inline]
    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }

    /// Returns the value `h` held before.
    ///
    /// # Panics
    /// When `h` is dead, or `key` comes from another schema.
    pub fn insert<T: Component>(&mut self, key: &Own<T>, h: Handle, value: T) -> Option<T> {
        assert!(self.is_alive(h), "insert on a dead handle");
        self.column_mut(key).insert(h.slot, value)
    }

    /// Inserts through a key found by name: for setup by a host that holds
    /// no write key. Returns the value `h` held before.
    ///
    /// # Panics
    /// When `h` is dead, `key` comes from another schema, or its column does not hold `T`.
    pub fn init<T: Component>(&mut self, key: AnyRead, h: Handle, value: T) -> Option<T> {
        assert!(self.is_alive(h), "init on a dead handle");
        let index = self.checked(key.id, key.prefix);
        let column: &mut dyn Any = &mut *self.columns[index];
        column
            .downcast_mut::<Column<T>>()
            .expect("init with a type its column does not hold")
            .insert(h.slot, value)
    }

    /// # Panics
    /// When `key` comes from another schema.
    #[must_use]
    pub fn get<T: Component>(&self, key: Read<T>, h: Handle) -> Option<&T> {
        let column = self.column(key);
        if !self.is_alive(h) {
            return None;
        }
        column.get(h.slot)
    }

    /// Whether `h` holds `key`: false for a dead handle.
    ///
    /// # Panics
    /// When `key` comes from another schema.
    #[must_use]
    pub fn has(&self, key: AnyRead, h: Handle) -> bool {
        let column = &self.columns[self.checked(key.id, key.prefix)];
        self.is_alive(h) && column.contains(h.slot)
    }

    /// # Panics
    /// When `key` comes from another schema.
    pub fn get_mut<T: Component>(&mut self, key: &Own<T>, h: Handle) -> Option<&mut T> {
        let alive = self.is_alive(h);
        let column = self.column_mut(key);
        if !alive {
            return None;
        }
        column.get_mut(h.slot)
    }

    /// Returns the value `h` held.
    ///
    /// # Panics
    /// When `h` is dead, or `key` comes from another schema.
    pub fn remove<T: Component>(&mut self, key: &Own<T>, h: Handle) -> Option<T> {
        assert!(self.is_alive(h), "remove on a dead handle");
        self.column_mut(key).remove(h.slot)
    }

    /// Every value of `key`, in dense order.
    ///
    /// # Panics
    /// When `key` comes from another schema.
    #[must_use]
    pub fn values<T: Component>(&self, key: Read<T>) -> &[T] {
        self.column(key).values()
    }

    /// Every value of `key`, in dense order. Without the owners, a bulk tick
    /// writes only the rows it iterates.
    ///
    /// # Panics
    /// When `key` comes from another schema.
    pub fn values_mut<T: Component>(&mut self, key: &Own<T>) -> &mut [T] {
        self.column_mut(key).values_mut()
    }

    /// Every holder of `key` and its value, in dense order.
    ///
    /// # Panics
    /// When `key` comes from another schema.
    pub fn iter<T: Component>(&self, key: Read<T>) -> impl Iterator<Item = (Handle, &T)> + '_ {
        let column = self.column(key);
        column
            .owners()
            .iter()
            .zip(column.values())
            .map(|(&slot, value)| (self.entities.handle_at(slot), value))
    }

    pub(crate) fn column<T: Component>(&self, key: Read<T>) -> &Column<T> {
        typed(&*self.columns[self.index(key)])
    }

    fn column_mut<T: Component>(&mut self, key: &Own<T>) -> &mut Column<T> {
        let index = self.index(key.read());
        typed_mut(&mut *self.columns[index])
    }

    /// The prefix check runs before any downcast: a key of another schema
    /// may name a column of the same type.
    pub(crate) fn index<T>(&self, key: Read<T>) -> usize {
        self.checked(key.id, key.prefix)
    }

    fn checked(&self, id: ComponentId, prefix: u64) -> usize {
        let index = id.0 as usize;
        assert!(self.prefixes.get(index) == Some(&prefix), "{FOREIGN_KEY}");
        index
    }
}

impl Debug for Store {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("Store")
            .field("floor", &self.floor())
            .field("len", &self.len())
            .field("columns", &self.columns.len())
            .finish_non_exhaustive()
    }
}
