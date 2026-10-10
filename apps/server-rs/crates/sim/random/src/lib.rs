#![deny(clippy::float_arithmetic)]

use std::num::NonZeroU32;

const GOLDEN: u64 = 0x9e37_79b9_7f4a_7c15;
const FNV_OFFSET: u64 = 0xcbf2_9ce4_8422_2325;
const FNV_PRIME: u64 = 0x0000_0100_0000_01b3;
const SUBJECT_LIMIT: u32 = 1 << 31;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum Phase {
    Propose = 1,
    Action,
    Tick,
    Spawn,
    Core,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Subject {
    Entity(u32),
    Cell(u32),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Seed(pub u64);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ModuleKey(u64);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct DrawIndex(pub u32);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Stream(u64);

// Evensen's Moremur: SplitMix64's shape with constants tuned on counter inputs.
const fn moremur(mut x: u64) -> u64 {
    x ^= x >> 27;
    x = x.wrapping_mul(0x3c79_ac49_2ba7_b653);
    x ^= x >> 33;
    x = x.wrapping_mul(0x1c69_b3f7_4ac4_ae35);
    x ^ (x >> 27)
}

// The added constant keeps an all-zero state from staying zero.
const fn absorb(h: u64, v: u64) -> u64 {
    moremur((h ^ v).wrapping_add(GOLDEN))
}

impl ModuleKey {
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
        Self(moremur(h))
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
            "subject {value} must fit 31 bits so entities and cells never alias"
        );
        u64::from(kind | value)
    }
}

impl Stream {
    #[must_use]
    pub fn new(seed: Seed, module: ModuleKey, phase: Phase, time: u64) -> Self {
        let h = absorb(absorb(0, seed.0), module.0);
        let h = absorb(h, u64::from(phase as u8));
        Self(absorb(h, time))
    }

    /// # Panics
    /// When the subject's value does not fit 31 bits.
    #[must_use]
    pub fn draw(self, subject: Subject, n: DrawIndex) -> u64 {
        absorb(self.0, (subject.packed() << 32) | u64::from(n.0))
    }

    /// A value in `0..bound`. Multiply-high leaves a bias below 2^-32 per
    /// outcome, so no draw is ever rejected.
    ///
    /// # Panics
    /// When the subject's value does not fit 31 bits.
    #[must_use]
    pub fn below(self, subject: Subject, n: DrawIndex, bound: NonZeroU32) -> u32 {
        let wide = u128::from(self.draw(subject, n)) * u128::from(bound.get());
        u32::try_from(wide >> 64).expect("the high word of x * bound is below bound")
    }
}
