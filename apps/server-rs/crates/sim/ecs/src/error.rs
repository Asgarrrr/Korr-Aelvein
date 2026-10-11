/// Why a floor image was rejected.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum ImageError {
    #[error("image truncated at byte {at}")]
    Truncated { at: usize },
    #[error("image checksum mismatch")]
    Checksum,
    #[error("image magic mismatch")]
    Magic,
    #[error("unsupported image version {0}")]
    Version(u16),
    #[error("column {index} differs from the schema")]
    Schema { index: u32 },
    #[error("row of schema {saved:#018x}, running {running:#018x}")]
    Fingerprint { saved: u64, running: u64 },
    #[error("corrupt image: {0}")]
    Corrupt(&'static str),
    #[error("{0} trailing bytes after the image")]
    Trailing(usize),
}
