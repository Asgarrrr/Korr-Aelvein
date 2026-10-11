#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum StepError {
    #[error("the target cell is not walkable")]
    Blocked,
    #[error("the height step is above MAX_STEP")]
    TooSteep,
    #[error("another actor holds the target cell")]
    Occupied,
}
