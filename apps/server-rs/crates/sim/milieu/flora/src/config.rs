use core::num::NonZeroU32;

/// A plant stops growing here; 1 is a seedling, so ripe is at least 2.
pub(crate) const RIPE: u8 = 8;
/// Chances out of `SPROUT_ODDS`, per ripe neighbour, that bare ground sprouts in a round.
pub(crate) const SPROUT_CHANCE: u32 = 1;
pub(crate) const SPROUT_ODDS: NonZeroU32 = NonZeroU32::new(16).expect("odds are above zero");
