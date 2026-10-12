//! Components and cell columns that one mechanic provides and others read,
//! and the requests one mechanic serves to others.
#![no_std]
#![deny(clippy::float_arithmetic)]

use korr_core::mechanic::{CellContract, Request};

/// The plants of a floor: a cell's value is its plant's growth, 0 for bare ground.
#[derive(Debug)]
pub struct Plants;

impl CellContract for Plants {
    const NAME: &'static str = "plants";
}

/// Eating the plant of a cell: its owner accepts a plant, replies with its
/// growth, and clears the cell.
#[derive(Debug)]
pub struct Graze;

impl Request for Graze {
    const NAME: &'static str = "graze";
}
