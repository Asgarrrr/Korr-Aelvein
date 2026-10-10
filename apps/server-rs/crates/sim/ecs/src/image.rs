//! Floor image v1. The byte layout and the order of the checks are in
//! `docs/plans/rust-structure.md`, section 7.

use alloc::vec::Vec;

use crate::codec::{Reader, Writer, checksum};
use crate::entities::Entities;
use crate::error::ImageError;
use crate::id::{COUNTER_MASK, FloorId};
use crate::schema::Schema;
use crate::store::Store;

const MAGIC: &[u8; 8] = b"KORRFLR\0";
const VERSION: u16 = 1;
const CHECKSUM_LEN: usize = 8;
/// Magic, version, floor, counter and checksum: the bytes before any count.
const MIN_LEN: usize = 28;

impl Store {
    /// The floor's image: every slot, the free stack and each column's dense
    /// order, so a reload replays identically.
    #[must_use]
    #[expect(
        clippy::cast_possible_truncation,
        reason = "register caps the component count at u32 and each name at u16 bytes"
    )]
    pub fn save(&self) -> Vec<u8> {
        let mut w = Writer::new();
        w.write_bytes(MAGIC);
        w.write_u16(VERSION);
        w.write_u16(self.floor.0);
        w.write_u64(self.next_counter);
        self.entities.write(&mut w);
        w.write_u32(self.columns.len() as u32);
        for (name, column) in self.names.iter().zip(&self.columns) {
            w.write_u16(name.len() as u16);
            w.write_bytes(name.as_bytes());
            column.write(&mut w);
        }
        let mut bytes = w.into_bytes();
        let sum = checksum(&bytes);
        bytes.extend_from_slice(&sum.to_le_bytes());
        bytes
    }

    /// The checksum is verified before any parsing.
    ///
    /// # Errors
    /// When `bytes` is not a valid image for `schema`.
    #[expect(
        clippy::cast_possible_truncation,
        reason = "register caps the component count at u32"
    )]
    pub fn load(schema: &Schema, bytes: &[u8]) -> Result<Self, ImageError> {
        if bytes.len() < MIN_LEN {
            return Err(ImageError::Truncated { at: bytes.len() });
        }
        let (body, sum) = bytes.split_at(bytes.len() - CHECKSUM_LEN);
        if Reader::new(sum).read_u64()? != checksum(body) {
            return Err(ImageError::Checksum);
        }

        let mut r = Reader::new(body);
        if r.read_bytes(MAGIC.len())? != MAGIC {
            return Err(ImageError::Magic);
        }
        let version = r.read_u16()?;
        if version != VERSION {
            return Err(ImageError::Version(version));
        }
        let mut store = Self::new(schema, FloorId(r.read_u16()?));
        store.next_counter = r.read_u64()?;
        store.entities = Entities::read(&mut r, store.floor, store.next_counter)?;

        let count = r.read_u32()?;
        let expected = store.columns.len() as u32;
        if count != expected {
            return Err(ImageError::Schema {
                index: count.min(expected),
            });
        }
        for (index, (name, column)) in (0..).zip(store.names.iter().zip(&mut store.columns)) {
            let len = r.read_u16()?;
            if r.read_bytes(usize::from(len))? != name.as_bytes() {
                return Err(ImageError::Schema { index });
            }
            column.read(&mut r, &store.entities)?;
        }
        r.finish()?;
        // No live store gets past 2^47: its next spawn could not name the entity.
        if store.next_counter > COUNTER_MASK + 1 {
            return Err(ImageError::Corrupt("floor counter"));
        }
        Ok(store)
    }
}
