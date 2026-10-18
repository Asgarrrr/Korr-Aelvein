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
/// The mass `Remains` lose each round.
pub const ROT_PER_ROUND: u16 = 1;
/// Deaths and spawns one floor records in a round; one more panics. Twice
/// the actors of the reference floor: every one dies and leaves remains.
pub const EVENTS_PER_ROUND: u32 = 1 << 14;
