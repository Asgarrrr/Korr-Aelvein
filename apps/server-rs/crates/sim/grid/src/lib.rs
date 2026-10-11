//! The grid of one floor: shape, coordinates, terrain, occupancy and cell columns.
#![no_std]
#![deny(clippy::float_arithmetic)]

extern crate alloc;

mod column;
mod config;
mod error;
mod grid;
mod image;
mod occupancy;
mod shape;
mod terrain;

pub use column::CellColumn;
pub use config::MAX_STEP;
pub use error::StepError;
pub use grid::Grid;
pub use occupancy::Layer;
pub use shape::{CellIdx, Dir, Interior, Pos, Shape};
pub use terrain::Material;
