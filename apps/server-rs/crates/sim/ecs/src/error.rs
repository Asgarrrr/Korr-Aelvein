/// Why a floor image was rejected.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum ImageError {
    #[error("image truncated at byte {at}")]
    Truncated { at: usize },
    #[error("image checksum mismatch")]
    Checksum,
    #[error("not a floor image")]
    Magic,
    #[error("unsupported image version {0}")]
    Version(u16),
    #[error("column {index} differs from the schema")]
    Schema { index: u32 },
    #[error("corrupt image: {0}")]
    Corrupt(&'static str),
    #[error("{0} trailing bytes after the image")]
    Trailing(usize),
}
