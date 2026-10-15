//! Components and cell columns that one mechanic provides and others read,
//! and the requests one mechanic serves to others.
#![no_std]
#![deny(clippy::float_arithmetic)]

use korr_core::mechanic::Request;

/// Eating the plant of a cell: its owner accepts a plant, replies with its
/// growth, and clears the cell. `Ask::cells` reads its column: a cell holds
/// its plant's growth, 0 for bare ground.
#[derive(Debug)]
pub struct Graze;

impl Request for Graze {
    const NAME: &'static str = "graze";
}
