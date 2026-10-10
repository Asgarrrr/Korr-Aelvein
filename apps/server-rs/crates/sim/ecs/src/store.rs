use alloc::boxed::Box;
use alloc::vec::Vec;
use core::fmt::{self, Debug};

use crate::codec::Component;
use crate::column::{Column, ErasedColumn, FOREIGN_KEY, typed, typed_mut};
use crate::entities::Entities;
use crate::id::{EntityId, FloorId, Handle};
use crate::schema::{ComponentKey, Schema};

/// The entities and component columns of one floor.
pub struct Store {
    pub(crate) floor: FloorId,
    pub(crate) next_counter: u64,
    pub(crate) entities: Entities,
    pub(crate) columns: Vec<Box<dyn ErasedColumn>>,
    pub(crate) names: Vec<&'static str>,
}

impl Store {
    #[must_use]
    pub fn new(schema: &Schema, floor: FloorId) -> Self {
        Self {
            floor,
            next_counter: 0,
            entities: Entities::default(),
            columns: schema
                .components
                .iter()
                .map(|info| (info.new_column)())
                .collect(),
            names: schema.components.iter().map(|info| info.name).collect(),
        }
    }

    #[must_use]
    #[inline]
    pub fn floor(&self) -> FloorId {
        self.floor
    }

    /// The new entity's id is never reused, even when its slot is.
    pub fn spawn(&mut self) -> Handle {
        let id = EntityId::new(self.floor, self.next_counter);
        self.next_counter += 1;
        self.entities.alloc(id)
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
    pub fn insert<T: Component>(&mut self, key: ComponentKey<T>, h: Handle, value: T) -> Option<T> {
        assert!(self.is_alive(h), "insert on a dead handle");
        self.column_mut(key).insert(h.slot, value)
    }

    /// # Panics
    /// When `key` comes from another schema.
    #[must_use]
    pub fn get<T: Component>(&self, key: ComponentKey<T>, h: Handle) -> Option<&T> {
        let column = self.column(key);
        if !self.is_alive(h) {
            return None;
        }
        column.get(h.slot)
    }

    /// # Panics
    /// When `key` comes from another schema.
    pub fn get_mut<T: Component>(&mut self, key: ComponentKey<T>, h: Handle) -> Option<&mut T> {
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
    pub fn remove<T: Component>(&mut self, key: ComponentKey<T>, h: Handle) -> Option<T> {
        assert!(self.is_alive(h), "remove on a dead handle");
        self.column_mut(key).remove(h.slot)
    }

    /// Every value of `key`, in dense order.
    ///
    /// # Panics
    /// When `key` comes from another schema.
    #[must_use]
    pub fn values<T: Component>(&self, key: ComponentKey<T>) -> &[T] {
        self.column(key).values()
    }

    /// Every value of `key`, in dense order. Without the owners, a bulk tick
    /// writes only the rows it iterates.
    ///
    /// # Panics
    /// When `key` comes from another schema.
    pub fn values_mut<T: Component>(&mut self, key: ComponentKey<T>) -> &mut [T] {
        self.column_mut(key).values_mut()
    }

    /// Every holder of `key` and its value, in dense order.
    ///
    /// # Panics
    /// When `key` comes from another schema.
    pub fn iter<T: Component>(
        &self,
        key: ComponentKey<T>,
    ) -> impl Iterator<Item = (Handle, &T)> + '_ {
        let column = self.column(key);
        column
            .owners()
            .iter()
            .zip(column.values())
            .map(|(&slot, value)| (self.entities.handle_at(slot), value))
    }

    pub(crate) fn column<T: Component>(&self, key: ComponentKey<T>) -> &Column<T> {
        typed(&**self.columns.get(key.id.0 as usize).expect(FOREIGN_KEY))
    }

    fn column_mut<T: Component>(&mut self, key: ComponentKey<T>) -> &mut Column<T> {
        typed_mut(&mut **self.columns.get_mut(key.id.0 as usize).expect(FOREIGN_KEY))
    }
}

impl Debug for Store {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("Store")
            .field("floor", &self.floor)
            .field("len", &self.len())
            .field("columns", &self.columns.len())
            .finish_non_exhaustive()
    }
}
