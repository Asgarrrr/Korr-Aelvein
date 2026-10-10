use korr_ecs::ImageError;

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum LoadError {
    #[error(transparent)]
    Image(#[from] ImageError),
    #[error("image saved under ruleset {saved:#018x}, running {running:#018x}")]
    Ruleset { saved: u64, running: u64 },
}
