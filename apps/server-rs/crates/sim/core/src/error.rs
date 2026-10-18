use korr_ecs::{EntityId, FloorId, ImageError};

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum LoadError {
    #[error(transparent)]
    Image(#[from] ImageError),
    #[error("image saved under ruleset {saved:#018x}, running {running:#018x}")]
    Ruleset { saved: u64, running: u64 },
    #[error("save made under seed {saved}, running {running}")]
    Seed { saved: u64, running: u64 },
    #[error(transparent)]
    World(#[from] WorldError),
}

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum WorldError {
    #[error("duplicate floor id {0:?}")]
    DuplicateFloor(FloorId),
    #[error("floors at different rounds")]
    Rounds,
    #[error("entity {0:?} alive or waiting on two floors")]
    DuplicateEntity(EntityId),
    #[error("entity {0:?} comes from a floor outside this world")]
    UnknownOrigin(EntityId),
    #[error("entity {0:?} is beyond its origin floor's counter")]
    BeyondCounter(EntityId),
}
