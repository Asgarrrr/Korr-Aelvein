use korr_ecs::{EntityId, FloorId, ImageError};

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum LoadError {
    #[error(transparent)]
    Image(#[from] ImageError),
    #[error("image saved under ruleset {saved:#018x}, running {running:#018x}")]
    Ruleset { saved: u64, running: u64 },
}

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum WorldError {
    #[error("duplicate floor id {0:?}")]
    DuplicateFloor(FloorId),
    #[error("floors at different rounds")]
    Rounds,
    #[error("entity {0:?} alive or waiting on two floors")]
    DuplicateEntity(EntityId),
}
