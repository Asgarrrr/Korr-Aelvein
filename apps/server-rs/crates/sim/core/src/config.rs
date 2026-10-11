use crate::time::Cost;

pub const TICKS_PER_ROUND: u64 = 100;
/// What a turn without a run action costs: every attempt consumes time.
pub(crate) const IDLE: Cost = Cost::new(100);
/// The weight bonus of the candidate that repeats the actor's intent.
pub(crate) const INERTIA: u16 = 5;
/// `Instead` hops allowed in one run; one more fails the run.
pub(crate) const MAX_INSTEAD: u8 = 4;
/// The Chebyshev radius `Senses` covers: the reference world's.
pub const SIGHT: u16 = 3;
