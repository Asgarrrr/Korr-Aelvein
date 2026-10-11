use core::num::NonZeroU32;

use korr_ecs::{Component, ImageError, Reader, Writer};

use crate::config::TICKS_PER_ROUND;

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub struct Tick(pub u64);

impl Tick {
    pub(crate) fn start_of(round: u64) -> Self {
        Self(round.checked_mul(TICKS_PER_ROUND).expect("clock overflow"))
    }

    pub(crate) fn after(self, c: Cost) -> Self {
        Self(
            self.0
                .checked_add(u64::from(c.0.get()))
                .expect("clock overflow"),
        )
    }
}

impl Component for Tick {
    const VERSION: u16 = 0;

    fn write(&self, w: &mut Writer) {
        w.write_u64(self.0);
    }

    fn read(r: &mut Reader<'_>) -> Result<Self, ImageError> {
        r.read_u64().map(Self)
    }
}

/// Never zero, so an actor that acts always moves the clock.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Cost(NonZeroU32);

impl Cost {
    /// # Panics
    /// When `ticks` is 0; a compile error in const context.
    #[must_use]
    pub const fn new(ticks: u32) -> Self {
        match NonZeroU32::new(ticks) {
            Some(ticks) => Self(ticks),
            None => panic!("a cost is at least one tick"),
        }
    }
}
