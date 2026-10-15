use core::fmt::{self, Debug};
use core::mem;

use crate::codec::Component;
use crate::column::{Column, typed_mut};
use crate::id::{FloorId, Handle};
use crate::schema::{Own, Read};
use crate::store::Store;

/// A column moved out of its store, so a hot loop reaches it without the
/// downcast. The store refuses its key until `restore`.
#[must_use = "restore it, or the store refuses its key"]
pub struct Lent<T> {
    key: Read<T>,
    /// The floor of the store that lent it.
    floor: FloorId,
    column: Column<T>,
}

impl Store {
    /// # Panics
    /// When `key` comes from another schema, or its column is already lent.
    pub fn lend<T: Component>(&mut self, key: &Own<T>) -> Lent<T> {
        let key = key.read();
        let index = self.index(key);
        let column = mem::replace(typed_mut(&mut *self.columns[index]), Column::new());
        self.prefixes[index] = !key.prefix;
        Lent {
            key,
            floor: self.floor(),
            column,
        }
    }

    /// # Panics
    /// When `lent` was not lent by this store's schema, or its column is
    /// back; in debug builds, when another floor's store lent it.
    pub fn restore<T: Component>(&mut self, lent: Lent<T>) {
        debug_assert!(lent.floor == self.floor(), "restore to another store");
        let index = lent.key.id.0 as usize;
        assert!(
            self.prefixes.get(index) == Some(&!lent.key.prefix),
            "restore of a column not lent"
        );
        self.prefixes[index] = lent.key.prefix;
        *typed_mut(&mut *self.columns[index]) = lent.column;
    }
}

const FOREIGN_STORE: &str = "a lent column serves only its lender";

impl<T> Lent<T> {
    /// # Panics
    /// In debug builds, when another floor's store lent it.
    #[must_use]
    #[inline]
    pub fn get(&self, store: &Store, h: Handle) -> Option<&T> {
        debug_assert!(self.floor == store.floor(), "{FOREIGN_STORE}");
        if !store.is_alive(h) {
            return None;
        }
        self.column.get(h.slot)
    }

    /// Returns the value `h` held before.
    ///
    /// # Panics
    /// When `h` is dead; in debug builds, when another floor's store lent it.
    #[inline]
    pub fn insert(&mut self, store: &Store, h: Handle, value: T) -> Option<T> {
        debug_assert!(self.floor == store.floor(), "{FOREIGN_STORE}");
        assert!(store.is_alive(h), "insert on a dead handle");
        self.column.insert(h.slot, value)
    }

    /// Returns the value `h` held.
    ///
    /// # Panics
    /// When `h` is dead; in debug builds, when another floor's store lent it.
    #[inline]
    pub fn remove(&mut self, store: &Store, h: Handle) -> Option<T> {
        debug_assert!(self.floor == store.floor(), "{FOREIGN_STORE}");
        assert!(store.is_alive(h), "remove on a dead handle");
        self.column.remove(h.slot)
    }

    /// `Store::despawn` cannot reach a lent column: call this with every
    /// despawn while lent, or the slot's next entity inherits the row.
    #[inline]
    pub fn clear(&mut self, h: Handle) {
        self.column.remove(h.slot);
    }
}

impl<T> Debug for Lent<T> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("Lent")
            .field("key", &self.key)
            .field("floor", &self.floor)
            .field("len", &self.column.values().len())
            .finish()
    }
}
