//! Components and cell columns that one mechanic provides and others read,
//! and the commands one mechanic serves to others.
#![no_std]
#![deny(clippy::float_arithmetic)]

use korr_core::mechanic::{CellContract, Command, Component, Contract, ImageError, Reader, Writer};

/// How urgently a creature needs to eat: 0 when sated, 255 when starving.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Appetite {
    pub urgency: u8,
}

impl Component for Appetite {
    const VERSION: u16 = 0;

    fn write(&self, w: &mut Writer) {
        w.write_u8(self.urgency);
    }

    fn read(r: &mut Reader<'_>) -> Result<Self, ImageError> {
        r.read_u8().map(|urgency| Self { urgency })
    }
}

impl Contract for Appetite {
    const NAME: &'static str = "appetite";
}

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

impl Command for Graze {
    const NAME: &'static str = "graze";
}
