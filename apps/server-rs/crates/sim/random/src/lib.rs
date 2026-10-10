//! Counter-based draws: each value is a pure hash of (seed, module, phase,
//! time, subject, index), so no call order or added module shifts a draw.
#![no_std]
#![deny(clippy::float_arithmetic)]

use core::num::NonZeroU32;

const GOLDEN: u64 = 0x9e37_79b9_7f4a_7c15;
const FNV_OFFSET: u64 = 0xcbf2_9ce4_8422_2325;
const FNV_PRIME: u64 = 0x0000_0100_0000_01b3;
const SUBJECT_LIMIT: u64 = 1 << 63;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Phase {
    Propose,
    Action,
    Tick,
    Spawn,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Subject {
    Entity(u64),
    Cell(u64),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Seed(pub u64);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ModuleKey(u64);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct DrawIndex(pub u32);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Stream(u64);

// Evensen's NASAM.
const fn nasam(mut x: u64) -> u64 {
    x ^= x.rotate_right(25) ^ x.rotate_right(47);
    x = x.wrapping_mul(0x9e6c_63d0_676a_9a99);
    x ^= (x >> 23) ^ (x >> 51);
    x = x.wrapping_mul(0x9e6d_62d0_6f6a_9a9b);
    x ^ (x >> 23) ^ (x >> 51)
}

// The added constant keeps NASAM's fixed point at zero off the zero state.
const fn absorb(h: u64, v: u64) -> u64 {
    nasam((h ^ v).wrapping_add(GOLDEN))
}

impl ModuleKey {
    /// The name is part of every draw's hash: renaming a module changes its draws.
    #[must_use]
    pub const fn of(name: &str) -> Self {
        let bytes = name.as_bytes();
        let mut h = FNV_OFFSET;
        let mut i = 0;
        // A const fn allows neither `for` nor `u64::from`.
        while i < bytes.len() {
            h = (h ^ bytes[i] as u64).wrapping_mul(FNV_PRIME);
            i += 1;
        }
        Self(nasam(h))
    }
}

impl Phase {
    // Pinned per variant: reordering or inserting a variant must not shift draws.
    const fn tag(self) -> u64 {
        match self {
            Self::Propose => 1,
            Self::Action => 2,
            Self::Tick => 3,
            Self::Spawn => 4,
        }
    }
}

impl Subject {
    fn packed(self) -> u64 {
        let (kind, value) = match self {
            Self::Entity(value) => (0, value),
            Self::Cell(value) => (SUBJECT_LIMIT, value),
        };
        assert!(
            value < SUBJECT_LIMIT,
            "subject {value} must fit 63 bits so entities and cells never alias"
        );
        kind | value
    }
}

impl Stream {
    #[must_use]
    #[inline]
    pub fn new(seed: Seed, module: ModuleKey, phase: Phase, time: u64) -> Self {
        let h = absorb(absorb(0, seed.0), module.0);
        let h = absorb(h, phase.tag());
        Self(absorb(h, time))
    }

    /// # Panics
    /// When the subject's value does not fit 63 bits.
    #[must_use]
    #[inline]
    pub fn draw(self, subject: Subject, n: DrawIndex) -> u64 {
        absorb(absorb(self.0, subject.packed()), u64::from(n.0))
    }

    /// A value in `0..bound`. Multiply-high leaves a bias below 2^-32 per
    /// outcome, so no draw is ever rejected.
    ///
    /// # Panics
    /// When the subject's value does not fit 63 bits.
    #[must_use]
    #[inline]
    pub fn below(self, subject: Subject, n: DrawIndex, bound: NonZeroU32) -> u32 {
        let wide = u128::from(self.draw(subject, n)) * u128::from(bound.get());
        u32::try_from(wide >> 64).expect("the high word of x * bound is below bound")
    }
}

#[cfg(test)]
mod tests {
    use super::{DrawIndex, Stream, Subject};

    // Two streams whose prefixes differ only in low bits must not share draws
    // at shifted indices: one fold of (prefix ^ subject ^ index) would.
    #[test]
    fn streams_one_bit_apart_share_no_draw() {
        let a = Stream(0).draw(Subject::Entity(0), DrawIndex(1));
        let b = Stream(1).draw(Subject::Entity(0), DrawIndex(0));
        assert_ne!(a, b);
    }
}
