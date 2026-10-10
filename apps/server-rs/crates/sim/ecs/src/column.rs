use alloc::vec::Vec;
use core::any::Any;

pub(crate) trait ErasedColumn: Any + Send {
    fn clear_slot(&mut self, slot: u32);
}

pub(crate) struct Column<T> {
    values: Vec<Option<T>>,
}

impl<T> Column<T> {
    pub(crate) const fn new() -> Self {
        Self { values: Vec::new() }
    }

    pub(crate) fn insert(&mut self, slot: u32, value: T) -> Option<T> {
        let index = slot as usize;
        if index >= self.values.len() {
            self.values.resize_with(index + 1, || None);
        }
        self.values[index].replace(value)
    }

    #[inline]
    pub(crate) fn get(&self, slot: u32) -> Option<&T> {
        self.values.get(slot as usize)?.as_ref()
    }
}

impl<T: Send + 'static> ErasedColumn for Column<T> {
    fn clear_slot(&mut self, slot: u32) {
        if let Some(value) = self.values.get_mut(slot as usize) {
            *value = None;
        }
    }
}
