//! A sparse set with `swap_remove` fixup, after shipyard 0.11.5 and sparsey
//! 0.13.4 (MIT OR Apache-2.0), an idea from `EnTT` (MIT). Design only.

use alloc::vec::Vec;
use core::any::Any;
use core::mem;

use crate::codec::{Component, Reader, Writer};
use crate::entities::Entities;
use crate::error::ImageError;
use crate::id::SlotIdx;

pub(crate) const FOREIGN_KEY: &str = "component key from another schema";

const ABSENT: u32 = u32::MAX;
const ROW_ABSENT: u8 = 0;
const ROW_PRESENT: u8 = 1;

pub(crate) trait ErasedColumn: Any + Send {
    fn clear_slot(&mut self, slot: SlotIdx);

    fn contains(&self, slot: SlotIdx) -> bool;

    fn write(&self, w: &mut Writer);

    /// Appends rows in image order, so the dense order survives a reload.
    fn read(&mut self, r: &mut Reader<'_>, entities: &Entities) -> Result<(), ImageError>;

    /// Writes the presence byte and the value, and removes the value.
    fn detach_row(&mut self, slot: SlotIdx, w: &mut Writer);

    fn attach_row(&mut self, slot: SlotIdx, r: &mut Reader<'_>) -> Result<(), ImageError>;

    fn check_row(&self, r: &mut Reader<'_>) -> Result<(), ImageError>;
}

#[inline]
pub(crate) fn find(sparse: &[u32], slot: SlotIdx) -> Option<usize> {
    match sparse.get(slot.index()) {
        Some(&index) if index != ABSENT => Some(index as usize),
        _ => None,
    }
}

pub(crate) fn typed<T: Component>(column: &dyn ErasedColumn) -> &Column<T> {
    let column: &dyn Any = column;
    column.downcast_ref().expect(FOREIGN_KEY)
}

pub(crate) fn typed_mut<T: Component>(column: &mut dyn ErasedColumn) -> &mut Column<T> {
    let column: &mut dyn Any = column;
    column.downcast_mut().expect(FOREIGN_KEY)
}

/// `sparse` maps a slot to its index in `dense` and `owners`; `owners` maps
/// it back. Dense order depends only on the sequence of operations.
pub(crate) struct Column<T> {
    sparse: Vec<u32>,
    dense: Vec<T>,
    owners: Vec<SlotIdx>,
}

impl<T> Column<T> {
    pub(crate) const fn new() -> Self {
        Self {
            sparse: Vec::new(),
            dense: Vec::new(),
            owners: Vec::new(),
        }
    }

    #[inline]
    fn index(&self, slot: SlotIdx) -> Option<usize> {
        find(&self.sparse, slot)
    }

    pub(crate) fn insert(&mut self, slot: SlotIdx, value: T) -> Option<T> {
        if let Some(existing) = self.get_mut(slot) {
            return Some(mem::replace(existing, value));
        }
        let at = slot.index();
        if at >= self.sparse.len() {
            self.sparse.resize(at + 1, ABSENT);
        }
        self.sparse[at] = u32::try_from(self.dense.len()).expect("fewer values than slots");
        self.dense.push(value);
        self.owners.push(slot);
        None
    }

    #[inline]
    pub(crate) fn get(&self, slot: SlotIdx) -> Option<&T> {
        self.index(slot).map(|index| &self.dense[index])
    }

    #[inline]
    pub(crate) fn get_mut(&mut self, slot: SlotIdx) -> Option<&mut T> {
        self.index(slot).map(|index| &mut self.dense[index])
    }

    pub(crate) fn remove(&mut self, slot: SlotIdx) -> Option<T> {
        let hole = self.index(slot)?;
        let value = self.dense.swap_remove(hole);
        self.owners.swap_remove(hole);
        if let Some(&moved) = self.owners.get(hole) {
            self.sparse[moved.index()] = self.sparse[slot.index()];
        }
        self.sparse[slot.index()] = ABSENT;
        Some(value)
    }

    #[inline]
    pub(crate) fn values(&self) -> &[T] {
        &self.dense
    }

    #[inline]
    pub(crate) fn values_mut(&mut self) -> &mut [T] {
        &mut self.dense
    }

    #[inline]
    pub(crate) fn owners(&self) -> &[SlotIdx] {
        &self.owners
    }
}

impl<T: Component> Column<T> {
    fn read_row(r: &mut Reader<'_>) -> Result<Option<T>, ImageError> {
        match r.read_u8()? {
            ROW_ABSENT => Ok(None),
            ROW_PRESENT => T::read(r).map(Some),
            _ => Err(ImageError::Corrupt("presence")),
        }
    }
}

impl<T: Component> ErasedColumn for Column<T> {
    fn clear_slot(&mut self, slot: SlotIdx) {
        self.remove(slot);
    }

    fn contains(&self, slot: SlotIdx) -> bool {
        self.index(slot).is_some()
    }

    fn write(&self, w: &mut Writer) {
        w.write_u32(u32::try_from(self.owners.len()).expect("fewer values than slots"));
        for (&slot, value) in self.owners.iter().zip(&self.dense) {
            w.write_u32(slot.get());
            value.write(w);
        }
    }

    fn read(&mut self, r: &mut Reader<'_>, entities: &Entities) -> Result<(), ImageError> {
        for _ in 0..r.read_u32()? {
            let slot = SlotIdx::new(r.read_u32()?);
            if !entities.is_slot_alive(slot) || self.index(slot).is_some() {
                return Err(ImageError::Corrupt("column owner"));
            }
            self.insert(slot, T::read(r)?);
        }
        Ok(())
    }

    fn detach_row(&mut self, slot: SlotIdx, w: &mut Writer) {
        match self.remove(slot) {
            None => w.write_u8(ROW_ABSENT),
            Some(value) => {
                w.write_u8(ROW_PRESENT);
                value.write(w);
            }
        }
    }

    fn attach_row(&mut self, slot: SlotIdx, r: &mut Reader<'_>) -> Result<(), ImageError> {
        if let Some(value) = Self::read_row(r)? {
            self.insert(slot, value);
        }
        Ok(())
    }

    fn check_row(&self, r: &mut Reader<'_>) -> Result<(), ImageError> {
        Self::read_row(r).map(drop)
    }
}
