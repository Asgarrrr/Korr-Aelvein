use crate::time::Cost;

pub const TICKS_PER_ROUND: u64 = 100;
/// What a turn without a run action costs: every attempt consumes time.
pub const IDLE: Cost = Cost::new(100);
