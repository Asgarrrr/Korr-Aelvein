const COUNTER_BITS: u32 = 47;
pub(crate) const COUNTER_MASK: u64 = (1 << COUNTER_BITS) - 1;

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct FloorId(pub u16);

/// An entity's name for life, never reused. Bit 63 stays zero so the id is
/// a valid random-draw subject; ordering is origin floor, then counter.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct EntityId(u64);

impl EntityId {
    /// # Panics
    /// When `counter` does not fit 47 bits.
    #[must_use]
    pub fn new(origin: FloorId, counter: u64) -> Self {
        assert!(
            counter <= COUNTER_MASK,
            "entity counter exhausted on floor {}",
            origin.0
        );
        Self(u64::from(origin.0) << COUNTER_BITS | counter)
    }

    /// `None` when bit 63 is set.
    #[must_use]
    pub const fn from_bits(bits: u64) -> Option<Self> {
        if bits >> 63 == 0 {
            Some(Self(bits))
        } else {
            None
        }
    }

    #[must_use]
    #[inline]
    #[expect(
        clippy::cast_possible_truncation,
        reason = "bit 63 is zero, so the bits above the counter fit 16 bits"
    )]
    pub const fn origin(self) -> FloorId {
        FloorId((self.0 >> COUNTER_BITS) as u16)
    }

    #[must_use]
    #[inline]
    pub const fn counter(self) -> u64 {
        self.0 & COUNTER_MASK
    }

    #[must_use]
    #[inline]
    pub const fn to_bits(self) -> u64 {
        self.0
    }
}

/// A slot and its generation. Valid only on the `Store` that returned it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct Handle {
    pub(crate) slot: u32,
    pub(crate) generation: u32,
}
