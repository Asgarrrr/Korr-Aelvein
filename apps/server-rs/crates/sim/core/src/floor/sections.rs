use alloc::vec::Vec;

use korr_ecs::{ImageError, Reader, Writer, checksum};
use korr_grid::Pos;

const CHECKSUM_LEN: usize = 8;

/// The framing of a floor image, little-endian: `u64` round, `u64` ruleset
/// fingerprint, the store, the grid, then a `u32` flight count and per flight
/// a `u64` round, `i16` x, `i16` y and the traveller. Each section is a `u32`
/// length then its bytes. A `u64` checksum of every byte before it ends the image.
/// A layout change bumps the save `VERSION` in `save.rs`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Sections {
    pub round: u64,
    pub fingerprint: u64,
    pub store: Vec<u8>,
    pub grid: Vec<u8>,
    pub flights: Vec<FlightImage>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FlightImage {
    /// The round the traveller left in.
    pub round: u64,
    pub at: Pos,
    pub traveller: Vec<u8>,
}

impl Sections {
    /// Checks the checksum and the framing only. Never panics.
    ///
    /// # Errors
    /// [`ImageError::Truncated`], [`ImageError::Checksum`], or
    /// [`ImageError::Trailing`] for bytes after the last flight.
    pub fn parse(bytes: &[u8]) -> Result<Self, ImageError> {
        if bytes.len() < CHECKSUM_LEN {
            return Err(ImageError::Truncated { at: bytes.len() });
        }
        let (body, sum) = bytes.split_at(bytes.len() - CHECKSUM_LEN);
        if Reader::new(sum).read_u64()? != checksum(body) {
            return Err(ImageError::Checksum);
        }

        let mut r = Reader::new(body);
        let round = r.read_u64()?;
        let fingerprint = r.read_u64()?;
        let store = read_section(&mut r)?;
        let grid = read_section(&mut r)?;
        let mut flights = Vec::new();
        for _ in 0..r.read_u32()? {
            flights.push(FlightImage {
                round: r.read_u64()?,
                at: Pos {
                    x: r.read_i16()?,
                    y: r.read_i16()?,
                },
                traveller: read_section(&mut r)?,
            });
        }
        r.finish()?;
        Ok(Self {
            round,
            fingerprint,
            store,
            grid,
            flights,
        })
    }

    /// # Panics
    /// When a section exceeds `u32::MAX` bytes or the inbox exceeds `u32::MAX` flights.
    #[must_use]
    pub fn seal(&self) -> Vec<u8> {
        let mut w = Writer::new();
        w.write_u64(self.round);
        w.write_u64(self.fingerprint);
        write_section(&mut w, &self.store);
        write_section(&mut w, &self.grid);
        w.write_u32(u32::try_from(self.flights.len()).expect("an inbox fits u32 flights"));
        for flight in &self.flights {
            w.write_u64(flight.round);
            w.write_i16(flight.at.x);
            w.write_i16(flight.at.y);
            write_section(&mut w, &flight.traveller);
        }
        let mut bytes = w.into_bytes();
        let sum = checksum(&bytes);
        bytes.extend_from_slice(&sum.to_le_bytes());
        bytes
    }
}

fn read_section(r: &mut Reader<'_>) -> Result<Vec<u8>, ImageError> {
    let len = r.read_u32()?;
    Ok(r.read_bytes(len as usize)?.to_vec())
}

fn write_section(w: &mut Writer, bytes: &[u8]) {
    w.write_u32(u32::try_from(bytes.len()).expect("a section fits u32 bytes"));
    w.write_bytes(bytes);
}
