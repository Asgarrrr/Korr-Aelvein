use alloc::boxed::Box;
use alloc::vec::Vec;
use core::any::Any;
use core::fmt::{self, Debug};

use crate::column::{Column, ErasedColumn};
use crate::entities::Entities;
use crate::id::{EntityId, FloorId, Handle};
use crate::schema::{ComponentKey, Schema};

const FOREIGN_KEY: &str = "component key from another schema";

/// The entities and component columns of one floor.
pub struct Store {
    floor: FloorId,
    next_counter: u64,
    entities: Entities,
    columns: Vec<Box<dyn ErasedColumn>>,
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
    pub fn insert<T: Send + 'static>(
        &mut self,
        key: ComponentKey<T>,
        h: Handle,
        value: T,
    ) -> Option<T> {
        assert!(self.is_alive(h), "insert on a dead handle");
        let column: &mut dyn Any =
            &mut **self.columns.get_mut(key.id.0 as usize).expect(FOREIGN_KEY);
        column
            .downcast_mut::<Column<T>>()
            .expect(FOREIGN_KEY)
            .insert(h.slot, value)
    }

    /// # Panics
    /// When `key` comes from another schema.
    #[must_use]
    pub fn get<T: Send + 'static>(&self, key: ComponentKey<T>, h: Handle) -> Option<&T> {
        let column: &dyn Any = &**self.columns.get(key.id.0 as usize).expect(FOREIGN_KEY);
        let column = column.downcast_ref::<Column<T>>().expect(FOREIGN_KEY);
        if !self.is_alive(h) {
            return None;
        }
        column.get(h.slot)
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
