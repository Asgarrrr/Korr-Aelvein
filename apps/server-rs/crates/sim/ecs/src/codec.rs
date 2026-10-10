//! A hand-written little-endian codec: the image format is ours, so no
//! serialization framework can change it under us.

use alloc::vec::Vec;

use crate::error::ImageError;

const FNV_OFFSET: u64 = 0xcbf2_9ce4_8422_2325;
const FNV_PRIME: u64 = 0x100_0000_01b3;

/// A value stored in a column. `read` is a pure function of the bytes and
/// consumes exactly what `write` produced.
pub trait Component: Sized + Send + 'static {
    fn write(&self, w: &mut Writer);

    /// # Errors
    /// When the bytes run out or do not encode a value.
    fn read(r: &mut Reader<'_>) -> Result<Self, ImageError>;
}

#[derive(Debug, Default)]
pub struct Writer {
    bytes: Vec<u8>,
}

impl Writer {
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    pub fn write_u8(&mut self, v: u8) {
        self.bytes.push(v);
    }

    pub fn write_u16(&mut self, v: u16) {
        self.write_bytes(&v.to_le_bytes());
    }

    pub fn write_u32(&mut self, v: u32) {
        self.write_bytes(&v.to_le_bytes());
    }

    pub fn write_u64(&mut self, v: u64) {
        self.write_bytes(&v.to_le_bytes());
    }

    pub fn write_i8(&mut self, v: i8) {
        self.write_bytes(&v.to_le_bytes());
    }

    pub fn write_i16(&mut self, v: i16) {
        self.write_bytes(&v.to_le_bytes());
    }

    pub fn write_i32(&mut self, v: i32) {
        self.write_bytes(&v.to_le_bytes());
    }

    pub fn write_i64(&mut self, v: i64) {
        self.write_bytes(&v.to_le_bytes());
    }

    /// Raw bytes: the caller writes the length when the reader needs it.
    pub fn write_bytes(&mut self, bytes: &[u8]) {
        self.bytes.extend_from_slice(bytes);
    }

    #[must_use]
    pub fn into_bytes(self) -> Vec<u8> {
        self.bytes
    }
}

#[derive(Debug)]
pub struct Reader<'a> {
    bytes: &'a [u8],
    at: usize,
}

impl<'a> Reader<'a> {
    #[must_use]
    pub const fn new(bytes: &'a [u8]) -> Self {
        Self { bytes, at: 0 }
    }

    #[must_use]
    pub const fn position(&self) -> usize {
        self.at
    }

    /// # Errors
    /// `Truncated` when fewer than `n` bytes remain.
    pub fn read_bytes(&mut self, n: usize) -> Result<&'a [u8], ImageError> {
        let Some(bytes) = (self.at.checked_add(n)).and_then(|end| self.bytes.get(self.at..end))
        else {
            return Err(ImageError::Truncated { at: self.at });
        };
        self.at += n;
        Ok(bytes)
    }

    fn array<const N: usize>(&mut self) -> Result<[u8; N], ImageError> {
        let mut out = [0; N];
        out.copy_from_slice(self.read_bytes(N)?);
        Ok(out)
    }

    /// # Errors
    /// `Truncated` when the bytes run out.
    pub fn read_u8(&mut self) -> Result<u8, ImageError> {
        self.array().map(u8::from_le_bytes)
    }

    /// # Errors
    /// `Truncated` when the bytes run out.
    pub fn read_u16(&mut self) -> Result<u16, ImageError> {
        self.array().map(u16::from_le_bytes)
    }

    /// # Errors
    /// `Truncated` when the bytes run out.
    pub fn read_u32(&mut self) -> Result<u32, ImageError> {
        self.array().map(u32::from_le_bytes)
    }

    /// # Errors
    /// `Truncated` when the bytes run out.
    pub fn read_u64(&mut self) -> Result<u64, ImageError> {
        self.array().map(u64::from_le_bytes)
    }

    /// # Errors
    /// `Truncated` when the bytes run out.
    pub fn read_i8(&mut self) -> Result<i8, ImageError> {
        self.array().map(i8::from_le_bytes)
    }

    /// # Errors
    /// `Truncated` when the bytes run out.
    pub fn read_i16(&mut self) -> Result<i16, ImageError> {
        self.array().map(i16::from_le_bytes)
    }

    /// # Errors
    /// `Truncated` when the bytes run out.
    pub fn read_i32(&mut self) -> Result<i32, ImageError> {
        self.array().map(i32::from_le_bytes)
    }

    /// # Errors
    /// `Truncated` when the bytes run out.
    pub fn read_i64(&mut self) -> Result<i64, ImageError> {
        self.array().map(i64::from_le_bytes)
    }

    /// # Errors
    /// `Trailing` with the count of unread bytes.
    pub fn finish(self) -> Result<(), ImageError> {
        match self.bytes.len() - self.at {
            0 => Ok(()),
            left => Err(ImageError::Trailing(left)),
        }
    }
}

/// FNV-1a 64.
#[must_use]
pub fn checksum(bytes: &[u8]) -> u64 {
    bytes.iter().fold(FNV_OFFSET, |hash, &byte| {
        (hash ^ u64::from(byte)).wrapping_mul(FNV_PRIME)
    })
}

#[cfg(test)]
mod tests {
    use super::{Reader, Writer, checksum};
    use crate::error::ImageError;

    #[test]
    fn checksum_matches_fnv_1a_64_vectors() {
        assert_eq!(checksum(b""), 0xcbf2_9ce4_8422_2325);
        assert_eq!(checksum(b"a"), 0xaf63_dc4c_8601_ec8c);
        assert_eq!(checksum(b"foobar"), 0x8594_4171_f739_67e8);
    }

    #[test]
    fn every_width_round_trips_little_endian() {
        let mut w = Writer::new();
        w.write_u8(0xA1);
        w.write_u16(0xB2C3);
        w.write_u32(0xD4E5_F607);
        w.write_u64(0x1829_3A4B_5C6D_7E8F);
        w.write_i8(-2);
        w.write_i16(-3);
        w.write_i32(-4);
        w.write_i64(-5);
        w.write_bytes(b"ok");
        let bytes = w.into_bytes();
        assert_eq!(&bytes[..7], &[0xA1, 0xC3, 0xB2, 0x07, 0xF6, 0xE5, 0xD4]);
        assert_eq!(bytes.len(), 1 + 2 + 4 + 8 + 1 + 2 + 4 + 8 + 2);

        let mut r = Reader::new(&bytes);
        assert_eq!(r.read_u8(), Ok(0xA1));
        assert_eq!(r.read_u16(), Ok(0xB2C3));
        assert_eq!(r.read_u32(), Ok(0xD4E5_F607));
        assert_eq!(r.read_u64(), Ok(0x1829_3A4B_5C6D_7E8F));
        assert_eq!(r.position(), 15);
        assert_eq!(r.read_i8(), Ok(-2));
        assert_eq!(r.read_i16(), Ok(-3));
        assert_eq!(r.read_i32(), Ok(-4));
        assert_eq!(r.read_i64(), Ok(-5));
        assert_eq!(r.read_bytes(2), Ok(&b"ok"[..]));
        assert_eq!(r.finish(), Ok(()));
    }

    #[test]
    fn short_reads_report_where_they_stopped() {
        let bytes = [1, 2, 3];
        let mut r = Reader::new(&bytes);
        assert_eq!(r.read_u8(), Ok(1));
        assert_eq!(r.read_u32(), Err(ImageError::Truncated { at: 1 }));
        assert_eq!(
            r.read_bytes(usize::MAX),
            Err(ImageError::Truncated { at: 1 })
        );
        assert_eq!(r.position(), 1);
        assert_eq!(r.finish(), Err(ImageError::Trailing(2)));
    }
}
