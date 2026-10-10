//! Travellers: entities in flight between floors. The byte layout and the
//! order of the checks are in `docs/plans/rust-structure.md`, section 7.

use alloc::boxed::Box;
use alloc::vec::Vec;

use crate::codec::{Reader, Writer};
use crate::column::ErasedColumn;
use crate::error::ImageError;
use crate::id::{EntityId, Handle};
use crate::store::Store;

/// An entity off every floor: its id and its row, encoded per column.
#[derive(Debug, PartialEq, Eq)]
pub struct Traveller {
    id: EntityId,
    row: Vec<u8>,
}

impl Traveller {
    #[must_use]
    #[inline]
    pub fn id(&self) -> EntityId {
        self.id
    }

    /// # Panics
    /// When the row is longer than `u32::MAX` bytes.
    pub fn write(&self, w: &mut Writer) {
        w.write_u64(self.id.to_bits());
        w.write_u32(u32::try_from(self.row.len()).expect("a row fits u32 bytes"));
        w.write_bytes(&self.row);
    }

    /// The row is checked only by `Store::attach`.
    ///
    /// # Errors
    /// When the id has bit 63 set or the bytes run out.
    pub fn read(r: &mut Reader<'_>) -> Result<Self, ImageError> {
        let id = EntityId::from_bits(r.read_u64()?).ok_or(ImageError::Corrupt("entity id"))?;
        let len = r.read_u32()?;
        let row = r.read_bytes(len as usize)?.to_vec();
        Ok(Self { id, row })
    }
}

impl Store {
    /// Takes `h` off this floor with every component. Its slot is freed as
    /// by `despawn`; its id leaves with the traveller.
    ///
    /// # Panics
    /// When `h` is dead.
    #[must_use]
    #[expect(
        clippy::cast_possible_truncation,
        reason = "register caps the component count at u32"
    )]
    pub fn detach(&mut self, h: Handle) -> Traveller {
        let id = self.entities.id(h).expect("detach of a dead handle");
        let mut w = Writer::new();
        w.write_u32(self.columns.len() as u32);
        for column in &mut self.columns {
            column.detach_row(h.slot, &mut w);
        }
        self.entities.free(h);
        Traveller {
            id,
            row: w.into_bytes(),
        }
    }

    /// All or nothing: on `Err` the store is unchanged. Does not check that
    /// the id is alive on no floor; detach always precedes attach. A caller
    /// that attaches one id twice, for example by reading the same bytes
    /// twice, makes `save` write an image that `load` rejects.
    ///
    /// # Errors
    /// When the id is beyond this floor's counter or the row does not
    /// match the schema.
    #[expect(
        clippy::cast_possible_truncation,
        reason = "register caps the component count at u32"
    )]
    #[expect(
        clippy::needless_pass_by_value,
        reason = "taking the traveller keeps one value from attaching twice"
    )]
    pub fn attach(&mut self, t: Traveller) -> Result<Handle, ImageError> {
        let arrival = self.entities.admit(t.id)?;
        let mut r = Reader::new(&t.row);
        let count = r.read_u32()?;
        if count != self.columns.len() as u32 {
            return Err(ImageError::Schema { index: count });
        }
        let slot = arrival.slot();
        if let Err(error) = attach_columns(&mut self.columns, slot, r) {
            for column in &mut self.columns {
                column.clear_slot(slot);
            }
            return Err(error);
        }
        Ok(self.entities.arrive(arrival))
    }
}

fn attach_columns(
    columns: &mut [Box<dyn ErasedColumn>],
    slot: u32,
    mut r: Reader<'_>,
) -> Result<(), ImageError> {
    for column in columns {
        column.attach_row(slot, &mut r)?;
    }
    r.finish()
}
